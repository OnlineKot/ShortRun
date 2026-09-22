/* Parser plistów: binarny (bplist00), XML oraz JSON.
   Zwraca zwykłe wartości JS: string, number, boolean, Date, Uint8Array, Array, Object. */
(function (root) {
  "use strict";

  function parseBinary(buf) {
    var view = new DataView(buf);
    var bytes = new Uint8Array(buf);
    if (buf.byteLength < 40) throw new Error("Plik jest za krótki jak na bplist.");

    var trailer = buf.byteLength - 32;
    var offsetSize = view.getUint8(trailer + 6);
    var refSize = view.getUint8(trailer + 7);
    var numObjects = readBig(view, trailer + 8);
    var topObject = readBig(view, trailer + 16);
    var tableOffset = readBig(view, trailer + 24);

    var offsets = new Array(numObjects);
    for (var i = 0; i < numObjects; i++) {
      offsets[i] = readSized(view, tableOffset + i * offsetSize, offsetSize);
    }

    var cache = new Array(numObjects);
    var visiting = new Array(numObjects);

    function readObject(index) {
      if (index >= numObjects) throw new Error("Odwołanie poza tablicą obiektów.");
      if (cache[index] !== undefined) return cache[index];
      if (visiting[index]) throw new Error("Cykliczne odwołanie w plist.");
      visiting[index] = true;

      var pos = offsets[index];
      var marker = view.getUint8(pos);
      var type = marker & 0xf0;
      var info = marker & 0x0f;
      var value;

      if (marker === 0x00) value = null;
      else if (marker === 0x08) value = false;
      else if (marker === 0x09) value = true;
      else if (type === 0x10) value = readInt(view, pos + 1, Math.pow(2, info));
      else if (type === 0x20) value = info === 2 ? view.getFloat32(pos + 1) : view.getFloat64(pos + 1);
      else if (type === 0x30) value = new Date(Date.UTC(2001, 0, 1) + view.getFloat64(pos + 1) * 1000);
      else if (type === 0x40) {
        var d = length(pos, info);
        value = bytes.slice(d.start, d.start + d.count);
      } else if (type === 0x50) {
        var a = length(pos, info);
        value = asciiString(bytes, a.start, a.count);
      } else if (type === 0x60) {
        var u = length(pos, info);
        value = utf16String(buf, u.start, u.count);
      } else if (type === 0x80) {
        value = { CFUID: readInt(view, pos + 1, info + 1) };
      } else if (type === 0xa0 || type === 0xc0) {
        var arr = length(pos, info);
        value = [];
        cache[index] = value;
        for (var k = 0; k < arr.count; k++) {
          value.push(readObject(readSized(view, arr.start + k * refSize, refSize)));
        }
      } else if (type === 0xd0) {
        var dict = length(pos, info);
        value = {};
        cache[index] = value;
        for (var j = 0; j < dict.count; j++) {
          var key = readObject(readSized(view, dict.start + j * refSize, refSize));
          var val = readObject(readSized(view, dict.start + dict.count * refSize + j * refSize, refSize));
          value[String(key)] = val;
        }
      } else {
        throw new Error("Nieznany znacznik bplist: 0x" + marker.toString(16));
      }

      cache[index] = value;
      visiting[index] = false;
      return value;
    }

    // Długość obiektu zmiennej wielkości: nibble 0xF oznacza, że długość
    // zapisano jako osobną liczbę całkowitą tuż za znacznikiem.
    function length(pos, info) {
      if (info !== 0x0f) return { start: pos + 1, count: info };
      var sizeMarker = view.getUint8(pos + 1);
      var intBytes = Math.pow(2, sizeMarker & 0x0f);
      return { start: pos + 2 + intBytes, count: readInt(view, pos + 2, intBytes) };
    }

    return readObject(topObject);
  }

  function readInt(view, pos, size) {
    if (size === 1) return view.getUint8(pos);
    if (size === 2) return view.getUint16(pos);
    if (size === 4) return view.getUint32(pos);
    if (size === 8) return readBig(view, pos);
    if (size === 16) return readBig(view, pos + 8);
    throw new Error("Nieobsługiwany rozmiar liczby: " + size);
  }

  function readBig(view, pos) {
    return view.getUint32(pos) * 4294967296 + view.getUint32(pos + 4);
  }

  function readSized(view, pos, size) {
    var out = 0;
    for (var i = 0; i < size; i++) out = out * 256 + view.getUint8(pos + i);
    return out;
  }

  function asciiString(bytes, start, count) {
    var out = "";
    for (var i = 0; i < count; i++) out += String.fromCharCode(bytes[start + i]);
    return out;
  }

  function utf16String(buf, start, count) {
    if (typeof TextDecoder === "function") {
      return new TextDecoder("utf-16be").decode(new Uint8Array(buf, start, count * 2));
    }
    var view = new DataView(buf);
    var out = "";
    for (var i = 0; i < count; i++) out += String.fromCharCode(view.getUint16(start + i * 2));
    return out;
  }

  /* ---------- XML plist ---------- */

  function parseXml(text) {
    if (typeof DOMParser !== "function") throw new Error("Brak DOMParsera dla plistów XML.");
    var doc = new DOMParser().parseFromString(text, "application/xml");
    if (doc.getElementsByTagName("parsererror").length) throw new Error("Niepoprawny plist XML.");
    var plist = doc.documentElement;
    var root = plist.tagName === "plist" ? firstElement(plist) : plist;
    return root ? xmlNode(root) : null;
  }

  function firstElement(node) {
    for (var i = 0; i < node.childNodes.length; i++) {
      if (node.childNodes[i].nodeType === 1) return node.childNodes[i];
    }
    return null;
  }

  function elements(node) {
    var out = [];
    for (var i = 0; i < node.childNodes.length; i++) {
      if (node.childNodes[i].nodeType === 1) out.push(node.childNodes[i]);
    }
    return out;
  }

  function xmlNode(node) {
    var tag = node.tagName;
    if (tag === "dict") {
      var kids = elements(node);
      var dict = {};
      for (var i = 0; i + 1 < kids.length; i += 2) {
        dict[kids[i].textContent] = xmlNode(kids[i + 1]);
      }
      return dict;
    }
    if (tag === "array") return elements(node).map(xmlNode);
    if (tag === "string") return node.textContent;
    if (tag === "integer" || tag === "real") return Number(node.textContent);
    if (tag === "true") return true;
    if (tag === "false") return false;
    if (tag === "date") return new Date(node.textContent);
    if (tag === "data") return base64ToBytes(node.textContent.replace(/\s+/g, ""));
    return null;
  }

  function base64ToBytes(b64) {
    var bin = typeof atob === "function" ? atob(b64) : Buffer.from(b64, "base64").toString("binary");
    var out = new Uint8Array(bin.length);
    for (var i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  }

  /* ---------- wejście dowolnego typu ---------- */

  function magic(buf) {
    var bytes = new Uint8Array(buf, 0, Math.min(8, buf.byteLength));
    var s = "";
    for (var i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
    return s;
  }

  function parse(data) {
    if (typeof data === "string") {
      var trimmed = data.replace(/^﻿/, "").trim();
      if (trimmed.charAt(0) === "{" || trimmed.charAt(0) === "[") return JSON.parse(trimmed);
      return parseXml(trimmed);
    }
    var buf = data instanceof ArrayBuffer ? data : data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength);
    var head = magic(buf);
    if (head.indexOf("bplist") === 0) return parseBinary(buf);
    if (head.indexOf("AEA") === 0) {
      var err = new Error("To jest podpisany skrót Apple (archiwum AEA). Przeglądarka nie potrafi go rozpakować.");
      err.code = "AEA";
      throw err;
    }
    var text = typeof TextDecoder === "function"
      ? new TextDecoder("utf-8").decode(new Uint8Array(buf))
      : asciiString(new Uint8Array(buf), 0, buf.byteLength);
    return parse(text);
  }

  root.plist = { parse: parse, parseBinary: parseBinary, parseXml: parseXml };
})(typeof window !== "undefined" ? (window.ShortRun = window.ShortRun || {}) : module.exports);
