/* Wczytywanie definicji skrótu: link iCloud, plik .shortcut/.plist/.json, wklejony tekst. */
(function (root) {
  "use strict";

  var ICLOUD_API = "https://www.icloud.com/shortcuts/api/records/";

  function idFromLink(link) {
    var text = String(link || "").trim();
    var m = /icloud\.com\/shortcuts\/(?:api\/records\/)?([0-9a-fA-F]{20,40})/.exec(text);
    if (m) return m[1];
    if (/^[0-9a-fA-F]{20,40}$/.test(text)) return text;
    return null;
  }

  // Proxy jest opcjonalne: iCloud nie zawsze odpowiada z nagłówkami CORS.
  // Szablon użytkownika musi zawierać {url}; wstawiamy adres zakodowany.
  function viaProxy(url, template) {
    if (!template) return url;
    return template.indexOf("{url}") !== -1
      ? template.replace("{url}", encodeURIComponent(url))
      : template + encodeURIComponent(url);
  }

  function fetchBuffer(url, proxy) {
    return fetch(url, { credentials: "omit" }).then(function (res) {
      if (!res.ok) throw new Error("HTTP " + res.status + " przy " + url);
      return res.arrayBuffer();
    }).catch(function (err) {
      if (!proxy) throw err;
      return fetch(viaProxy(url, proxy), { credentials: "omit" }).then(function (res) {
        if (!res.ok) throw new Error("HTTP " + res.status + " (proxy)");
        return res.arrayBuffer();
      });
    });
  }

  function fetchJson(url, proxy) {
    return fetchBuffer(url, proxy).then(function (buf) {
      return JSON.parse(new TextDecoder("utf-8").decode(new Uint8Array(buf)));
    });
  }

  function fromICloud(link, options) {
    options = options || {};
    var id = idFromLink(link);
    if (!id) {
      return Promise.reject(new Error("To nie wygląda na link iCloud do skrótu (oczekiwano icloud.com/shortcuts/…)."));
    }
    var proxy = options.proxy || "";
    var meta = null;

    return fetchJson(ICLOUD_API + id, proxy).then(function (record) {
      // Nieistniejący lub cofnięty skrót: API odpowiada zwykłym JSON-em z błędem.
      if (!record || record.error) {
        throw new Error("iCloud nie zna tego skrótu (" + ((record && record.reason) || "brak rekordu") +
          "). Link mógł zostać wycofany przez autora.");
      }
      if (record.deleted) throw new Error("Autor przestał udostępniać ten skrót.");

      var fields = record.fields || {};
      meta = {
        name: value(fields.name) || "Skrót",
        id: id,
        iconColor: value(fields.icon_color),
        iconGlyph: value(fields.icon_glyph),
        link: "https://www.icloud.com/shortcuts/" + id
      };

      // Rekord niesie dwa pliki: „shortcut” (zwykły plist) oraz „signedShortcut”
      // (wersja podpisana, zwykle archiwum AEA). Zaczynamy od tego pierwszego.
      var assets = [value(fields.shortcut), value(fields.signedShortcut)]
        .filter(Boolean)
        .map(function (asset) { return assetUrl(asset); })
        .filter(Boolean);

      if (!assets.length) throw new Error("Rekord iCloud nie zawiera pliku skrótu.");
      return tryAssets(assets, proxy);
    }).then(function (shortcut) {
      shortcut.__meta = meta;
      return shortcut;
    });
  }

  // CloudKit zwraca adres z placeholderem ${f} w miejscu nazwy pliku.
  function assetUrl(asset) {
    var url = asset.downloadURL || asset.url;
    return url ? url.replace("${f}", "shortcut.plist") : null;
  }

  function tryAssets(urls, proxy) {
    return urls.reduce(function (chain, url) {
      return chain.catch(function (previous) {
        return fetchBuffer(url, proxy)
          .then(function (buf) { return extract(root.plist.parse(buf)); })
          .catch(function (err) { throw previous && previous.code === "AEA" ? previous : err; });
      });
    }, Promise.reject(null));
  }

  function value(field) {
    return field && field.value !== undefined ? field.value : undefined;
  }

  function fromFile(file) {
    return new Promise(function (resolve, reject) {
      var reader = new FileReader();
      reader.onerror = function () { reject(new Error("Nie udało się odczytać pliku.")); };
      reader.onload = function () {
        try {
          var shortcut = extract(root.plist.parse(new Uint8Array(reader.result)));
          shortcut.__meta = { name: file.name.replace(/\.[^.]+$/, ""), source: "plik" };
          resolve(shortcut);
        } catch (e) { reject(e); }
      };
      reader.readAsArrayBuffer(file);
    });
  }

  function fromText(text) {
    return new Promise(function (resolve) {
      var shortcut = extract(root.plist.parse(text));
      shortcut.__meta = { name: "Wklejona definicja", source: "tekst" };
      resolve(shortcut);
    });
  }

  /* Niektóre pliki opakowują właściwą definicję w kolejny plist
     (np. pole z osadzonymi danymi). Schodzimy w dół, dopóki nie znajdziemy akcji. */
  function extract(parsed, depth) {
    depth = depth || 0;
    if (!parsed || depth > 4) throw new Error("W pliku nie znaleziono akcji skrótu (WFWorkflowActions).");
    if (Array.isArray(parsed.WFWorkflowActions)) return parsed;
    if (Array.isArray(parsed)) {
      for (var i = 0; i < parsed.length; i++) {
        try { return extract(parsed[i], depth + 1); } catch (e) { /* próbujemy dalej */ }
      }
    }
    if (typeof parsed === "object") {
      var keys = Object.keys(parsed);
      for (var j = 0; j < keys.length; j++) {
        var v = parsed[keys[j]];
        if (v instanceof Uint8Array && v.length > 8) {
          try { return extract(root.plist.parse(v), depth + 1); } catch (e) { /* próbujemy dalej */ }
        } else if (v && typeof v === "object") {
          try { return extract(v, depth + 1); } catch (e) { /* próbujemy dalej */ }
        }
      }
    }
    throw new Error("W pliku nie znaleziono akcji skrótu (WFWorkflowActions).");
  }

  root.loader = {
    fromICloud: fromICloud,
    fromFile: fromFile,
    fromText: fromText,
    idFromLink: idFromLink,
    extract: extract
  };
})(typeof window !== "undefined" ? (window.ShortRun = window.ShortRun || {}) : module.exports);
