/* Implementacje akcji Skrótów. Każdy wpis: { label, describe?, run(params, ctx, node) }.
   Akcja zwraca wartość (staje się wynikiem i zmienną magiczną) albo undefined. */
(function (root) {
  "use strict";

  var V = root.val;
  var toText = V.toText, toNumber = V.toNumber, toList = V.toList, toDict = V.toDict;

  var MAP = {};

  function def(ids, spec) {
    (Array.isArray(ids) ? ids : [ids]).forEach(function (id) {
      MAP["is.workflow.actions." + id] = spec;
    });
  }

  function inputOf(params, ctx, key) {
    var value = params[key || "WFInput"];
    if (value === undefined || value === null || value === "") return ctx.last;
    return value;
  }

  function stop(ctx) {
    ctx.stopped = true;
    var err = new Error("Zatrzymano skrót.");
    err.__stop = true;
    return err;
  }

  /* ---------- tekst ---------- */

  def("gettext", {
    label: "Tekst",
    describe: function (p) { return short(toText(p.WFTextActionText)); },
    run: function (p) { return toText(p.WFTextActionText); }
  });

  def("text.combine", {
    label: "Połącz tekst",
    run: function (p, ctx) {
      var sep = p.WFTextSeparator === "Custom" ? toText(p.WFTextCustomSeparator)
        : p.WFTextSeparator === "Spaces" ? " "
        : p.WFTextSeparator === "Nothing" ? "" : "\n";
      return toList(inputOf(p, ctx)).map(toText).join(sep);
    }
  });

  def("text.split", {
    label: "Podziel tekst",
    run: function (p, ctx) {
      var sep = p.WFTextSeparator === "Custom" ? toText(p.WFTextCustomSeparator)
        : p.WFTextSeparator === "Spaces" ? " "
        : p.WFTextSeparator === "Every Character" ? ""
        : "\n";
      var text = toText(inputOf(p, ctx));
      return sep === "" ? text.split("") : text.split(sep);
    }
  });

  def("text.replace", {
    label: "Zamień tekst",
    run: function (p, ctx) {
      var text = toText(inputOf(p, ctx));
      var find = toText(p.WFReplaceTextFind);
      var repl = toText(p.WFReplaceTextReplace);
      var flags = "g" + (p.WFReplaceTextCaseSensitive === false ? "i" : "");
      if (p.WFReplaceTextRegularExpression) return text.replace(new RegExp(find, flags), repl);
      return text.replace(new RegExp(escapeRe(find), flags), repl);
    }
  });

  def("text.match", {
    label: "Dopasuj tekst",
    run: function (p, ctx) {
      var text = toText(inputOf(p, ctx));
      var re = new RegExp(toText(p.WFMatchTextPattern), "g" + (p.WFMatchTextCaseSensitive === false ? "i" : ""));
      return text.match(re) || [];
    }
  });

  def("text.changecase", {
    label: "Zmień wielkość liter",
    run: function (p, ctx) {
      var text = toText(inputOf(p, ctx));
      var mode = p.WFCaseType || "UPPERCASE";
      if (mode === "UPPERCASE") return text.toUpperCase();
      if (mode === "lowercase") return text.toLowerCase();
      if (mode === "Capitalize Every Word" || mode === "Title Case") {
        return text.replace(/\S+/g, function (w) { return w.charAt(0).toUpperCase() + w.slice(1).toLowerCase(); });
      }
      if (mode === "Capitalize with sentence case") {
        return text.charAt(0).toUpperCase() + text.slice(1).toLowerCase();
      }
      return text;
    }
  });

  def("detect.text", { label: "Pobierz tekst z wejścia", run: function (p, ctx) { return toText(inputOf(p, ctx)); } });

  def("count", {
    label: "Policz",
    run: function (p, ctx) {
      var value = inputOf(p, ctx);
      var type = p.WFCountType || "Items";
      if (type === "Characters") return toText(value).length;
      if (type === "Words") return (toText(value).match(/\S+/g) || []).length;
      if (type === "Lines") return toText(value).split("\n").length;
      if (type === "Sentences") return (toText(value).match(/[^.!?]+[.!?]?/g) || []).length;
      return toList(value).length;
    }
  });

  /* ---------- liczby ---------- */

  def("number", { label: "Liczba", run: function (p, ctx) { return toNumber(p.WFNumberActionNumber !== undefined ? p.WFNumberActionNumber : inputOf(p, ctx)); } });

  def("detect.number", { label: "Pobierz liczbę z wejścia", run: function (p, ctx) { return toNumber(inputOf(p, ctx)); } });

  def("number.random", {
    label: "Losowa liczba",
    run: function (p) {
      var min = toNumber(p.WFRandomNumberMinimum);
      var max = toNumber(p.WFRandomNumberMaximum);
      if (max < min) { var t = min; min = max; max = t; }
      return Math.floor(Math.random() * (max - min + 1)) + min;
    }
  });

  def("math", {
    label: "Oblicz",
    describe: function (p) { return toText(p.WFMathOperation) + " " + toText(p.WFMathOperand); },
    run: function (p, ctx) {
      var a = toNumber(inputOf(p, ctx));
      var b = toNumber(p.WFMathOperand);
      switch (p.WFMathOperation) {
        case "+": return a + b;
        case "-": return a - b;
        case "×": case "*": return a * b;
        case "÷": case "/": return b === 0 ? 0 : a / b;
        case "%": case "mod": return b === 0 ? 0 : a % b;
        case "^": return Math.pow(a, b);
        default: return a;
      }
    }
  });

  def("calculateexpression", {
    label: "Oblicz wyrażenie",
    run: function (p, ctx) {
      var expr = toText(p.Input !== undefined ? p.Input : inputOf(p, ctx));
      return evalExpression(expr);
    }
  });

  def("round", {
    label: "Zaokrąglij",
    run: function (p, ctx) {
      var n = toNumber(inputOf(p, ctx));
      var mode = p.WFRoundMode || "Normal";
      if (mode === "Always Round Up") return Math.ceil(n);
      if (mode === "Always Round Down") return Math.floor(n);
      return Math.round(n);
    }
  });

  /* ---------- zmienne ---------- */

  def("setvariable", {
    label: "Ustaw zmienną",
    describe: function (p) { return toText(p.WFVariableName); },
    run: function (p, ctx) {
      var value = p.WFInput !== undefined && p.WFInput !== null && p.WFInput !== "" ? p.WFInput : ctx.last;
      ctx.setVar(p.WFVariableName, value);
      return value;
    }
  });

  def("appendvariable", {
    label: "Dodaj do zmiennej",
    run: function (p, ctx) {
      var name = toText(p.WFVariableName);
      var value = p.WFInput !== undefined && p.WFInput !== null && p.WFInput !== "" ? p.WFInput : ctx.last;
      var current = ctx.vars[name];
      var list = current === undefined ? [] : toList(current);
      list.push(value);
      ctx.setVar(name, list);
      return list;
    }
  });

  def("getvariable", {
    label: "Pobierz zmienną",
    describe: function (p) { return toText(p.WFVariable && p.WFVariable.VariableName ? p.WFVariable.VariableName : p.WFVariable); },
    run: function (p, ctx) {
      if (p.WFVariable !== undefined && typeof p.WFVariable !== "object") return ctx.getVar(p.WFVariable);
      return p.WFVariable !== undefined ? p.WFVariable : ctx.last;
    }
  });

  def("nothing", { label: "Nic", run: function () { return ""; } });
  def("comment", { label: "Komentarz", describe: function (p) { return short(toText(p.WFCommentActionText)); }, run: function () { return undefined; } });

  /* ---------- słowniki i listy ---------- */

  def("dictionary", { label: "Słownik", run: function (p) { return toDict(p.WFItems); } });

  def("detect.dictionary", {
    label: "Pobierz słownik z wejścia",
    run: function (p, ctx) {
      var value = inputOf(p, ctx);
      var dict = toDict(value);
      if (!Object.keys(dict).length && Array.isArray(value)) return value;
      return dict;
    }
  });

  def("getvalueforkey", {
    label: "Pobierz wartość ze słownika",
    describe: function (p) { return toText(p.WFDictionaryKey); },
    run: function (p, ctx) {
      var source = toDict(inputOf(p, ctx));
      var mode = p.WFGetDictionaryValueType || "Value";
      if (mode === "All Keys") return Object.keys(source);
      if (mode === "All Values") return Object.keys(source).map(function (k) { return source[k]; });
      return lookupPath(source, toText(p.WFDictionaryKey));
    }
  });

  def("setvalueforkey", {
    label: "Ustaw wartość w słowniku",
    run: function (p, ctx) {
      var dict = toDict(inputOf(p, ctx, "WFDictionary"));
      var copy = {};
      Object.keys(dict).forEach(function (k) { copy[k] = dict[k]; });
      copy[toText(p.WFDictionaryKey)] = p.WFDictionaryValue;
      return copy;
    }
  });

  def("list", { label: "Lista", run: function (p) { return toList(p.WFItems); } });

  def("getitemfromlist", {
    label: "Pobierz element z listy",
    run: function (p, ctx) {
      var list = toList(inputOf(p, ctx));
      var mode = p.WFItemSpecifier || "First Item";
      if (mode === "First Item") return list[0];
      if (mode === "Last Item") return list[list.length - 1];
      if (mode === "Random Item") return list[Math.floor(Math.random() * list.length)];
      if (mode === "Item At Index") return list[Math.max(0, toNumber(p.WFItemIndex) - 1)];
      if (mode === "Items in Range") {
        return list.slice(Math.max(0, toNumber(p.WFItemRangeStart) - 1), toNumber(p.WFItemRangeEnd));
      }
      return list[0];
    }
  });

  def("filter.contacts", { label: "Filtruj listę", run: function (p, ctx) { return toList(inputOf(p, ctx)); } });

  /* ---------- interakcja ---------- */

  def("ask", {
    label: "Zapytaj o dane",
    describe: function (p) { return short(toText(p.WFAskActionPrompt)); },
    run: function (p, ctx) {
      var type = p.WFInputType === "Number" ? "number" : "text";
      return ctx.ui.ask(toText(p.WFAskActionPrompt) || "Podaj wartość", toText(p.WFAskActionDefaultAnswer), type)
        .then(function (answer) {
          if (answer === null) throw stop(ctx);
          return type === "number" ? toNumber(answer) : answer;
        });
    }
  });

  def("choosefromlist", {
    label: "Wybierz z listy",
    run: function (p, ctx) {
      var list = toList(inputOf(p, ctx)).map(toText);
      var multiple = !!p.WFChooseFromListActionSelectMultiple;
      return ctx.ui.choose(toText(p.WFChooseFromListActionPrompt) || "Wybierz", list, multiple)
        .then(function (choice) {
          if (choice === null) throw stop(ctx);
          return choice;
        });
    }
  });

  def("alert", {
    label: "Pokaż alert",
    run: function (p, ctx) {
      return ctx.ui.show(toText(p.WFAlertActionTitle) || "Alert", toText(p.WFAlertActionMessage))
        .then(function (ok) {
          if (ok === false && p.WFAlertActionCancelButtonShown !== false) throw stop(ctx);
          return undefined;
        });
    }
  });

  def("showresult", {
    label: "Pokaż wynik",
    run: function (p, ctx) {
      var text = p.Text !== undefined && p.Text !== "" ? toText(p.Text) : toText(ctx.last);
      return ctx.ui.show("Wynik", text).then(function () { return text; });
    }
  });

  def("shownotification", {
    label: "Powiadomienie",
    run: function (p, ctx) {
      ctx.ui.notify(toText(p.WFNotificationActionTitle) || "Skrót", toText(p.WFNotificationActionBody));
      return undefined;
    }
  });

  def("speaktext", {
    label: "Przeczytaj tekst",
    run: function (p, ctx) {
      var text = toText(inputOf(p, ctx, "WFText"));
      ctx.ui.speak(text, { rate: toNumber(p.WFSpeakTextRate) || 1, pitch: toNumber(p.WFSpeakTextPitch) || 1 });
      return undefined;
    }
  });

  def("output", {
    label: "Zakończ i zwróć",
    run: function (p, ctx) {
      ctx.output = p.WFOutput !== undefined ? p.WFOutput : ctx.last;
      throw stop(ctx);
    }
  });

  def("exit", { label: "Zatrzymaj skrót", run: function (p, ctx) { throw stop(ctx); } });

  def("delay", {
    label: "Czekaj",
    run: function (p, ctx) {
      var ms = Math.min(30000, toNumber(p.WFDelayTime) * 1000);
      return new Promise(function (resolve) { setTimeout(resolve, ms); }).then(function () { return undefined; });
    }
  });

  /* ---------- schowek, adresy, sieć ---------- */

  def("setclipboard", {
    label: "Kopiuj do schowka",
    run: function (p, ctx) {
      var text = toText(inputOf(p, ctx));
      ctx.clipboard = text;
      ctx.ui.copy(text);
      return undefined;
    }
  });

  def("getclipboard", { label: "Pobierz schowek", run: function (p, ctx) { return ctx.clipboard; } });

  def("url", {
    label: "Adres URL",
    run: function (p, ctx) {
      var value = p.WFURLActionURL !== undefined ? p.WFURLActionURL : inputOf(p, ctx);
      return Array.isArray(value) ? value.map(toText) : toText(value);
    }
  });

  def("urlencode", {
    label: "Koduj adres URL",
    run: function (p, ctx) {
      var text = toText(inputOf(p, ctx));
      return p.WFEncodeMode === "Decode" ? decodeURIComponent(text) : encodeURIComponent(text);
    }
  });

  def("base64encode", {
    label: "Base64",
    run: function (p, ctx) {
      var text = toText(inputOf(p, ctx));
      return p.WFEncodeMode === "Decode" ? ctx.ui.base64Decode(text) : ctx.ui.base64Encode(text);
    }
  });

  def("openurl", {
    label: "Otwórz adres URL",
    run: function (p, ctx) {
      var url = toText(inputOf(p, ctx, "WFInput"));
      ctx.ui.open(url);
      return url;
    }
  });

  def("downloadurl", {
    label: "Pobierz zawartość URL",
    describe: function (p) { return toText(p.WFHTTPMethod || "GET") + " " + short(toText(p.WFURL)); },
    run: function (p, ctx) {
      var url = toText(p.WFURL !== undefined && p.WFURL !== "" ? p.WFURL : inputOf(p, ctx));
      var method = toText(p.WFHTTPMethod || "GET").toUpperCase();
      var headers = toDict(p.WFHTTPHeaders);
      var body = null;
      if (p.WFHTTPBodyType === "JSON" && p.WFJSONValues !== undefined) {
        body = JSON.stringify(toDict(p.WFJSONValues));
        if (!headerKey(headers, "content-type")) headers["Content-Type"] = "application/json";
      } else if (p.WFHTTPBodyType === "Form" && p.WFFormValues !== undefined) {
        body = new URLSearchParams(flatten(toDict(p.WFFormValues))).toString();
        if (!headerKey(headers, "content-type")) headers["Content-Type"] = "application/x-www-form-urlencoded";
      } else if (p.WFHTTPBodyType === "File" && p.WFRequestVariable !== undefined) {
        body = toText(p.WFRequestVariable);
      }
      return ctx.ui.request(url, { method: method, headers: headers, body: body });
    }
  });

  def("getwebpagecontents", {
    label: "Pobierz treść strony",
    run: function (p, ctx) {
      var url = toText(inputOf(p, ctx));
      return ctx.ui.request(url, { method: "GET" }).then(function (res) {
        return toText(res).replace(/<script[\s\S]*?<\/script>/gi, "")
                          .replace(/<style[\s\S]*?<\/style>/gi, "")
                          .replace(/<[^>]+>/g, " ")
                          .replace(/\s{2,}/g, " ")
                          .trim();
      });
    }
  });

  def("getvalueforkey.json", { label: "Wartość z JSON", run: function (p, ctx) { return lookupPath(toDict(inputOf(p, ctx)), toText(p.WFDictionaryKey)); } });

  /* ---------- urządzenie ---------- */

  def("date", {
    label: "Data",
    run: function (p) {
      var raw = toText(p.WFDateActionDate);
      if (!raw || /current/i.test(toText(p.WFDateActionMode))) return new Date();
      var parsed = new Date(raw);
      return isNaN(parsed.getTime()) ? new Date() : parsed;
    }
  });

  def("format.date", {
    label: "Sformatuj datę",
    run: function (p, ctx) {
      var value = inputOf(p, ctx, "WFDate");
      var date = value instanceof Date ? value : new Date(toText(value));
      if (isNaN(date.getTime())) date = new Date();
      var style = toText(p.WFDateFormatStyle);
      if (style === "Custom") return formatCustomDate(date, toText(p.WFDateFormat));
      if (style === "Short") return date.toLocaleDateString();
      if (style === "Long" || style === "Full") return date.toLocaleString();
      if (style === "ISO 8601" || style === "RFC 2822") return date.toISOString();
      return date.toLocaleString();
    }
  });

  def("getcurrentlocation", { label: "Bieżąca lokalizacja", run: function (p, ctx) { return ctx.ui.location(); } });

  def("getbatterylevel", { label: "Poziom baterii", run: function (p, ctx) { return ctx.ui.battery(); } });

  def("getdevicedetails", {
    label: "Dane urządzenia",
    run: function (p, ctx) { return ctx.ui.device(toText(p.WFDeviceDetail)); }
  });

  def("vibrate", { label: "Wibracja", run: function (p, ctx) { ctx.ui.vibrate(); return undefined; } });

  /* ---------- pomocnicze ---------- */

  function escapeRe(s) { return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"); }

  function short(text) { return text.length > 60 ? text.slice(0, 60) + "…" : text; }

  function headerKey(headers, name) {
    return Object.keys(headers).some(function (k) { return k.toLowerCase() === name; });
  }

  function flatten(dict) {
    var out = {};
    Object.keys(dict).forEach(function (k) { out[k] = toText(dict[k]); });
    return out;
  }

  // Klucz może być ścieżką („a.b.0.c”), tak jak w akcji „Pobierz wartość”.
  function lookupPath(source, path) {
    if (path === "") return source;
    var parts = path.split(".");
    var current = source;
    for (var i = 0; i < parts.length; i++) {
      if (current === null || current === undefined) return "";
      if (Array.isArray(current)) {
        var index = parseInt(parts[i], 10);
        current = isNaN(index) ? current.map(function (x) { return toDict(x)[parts[i]]; }) : current[index];
      } else {
        current = toDict(current)[parts[i]];
      }
    }
    return current === undefined ? "" : current;
  }

  // Bezpieczny kalkulator: tylko liczby, nawiasy i podstawowe operatory.
  function evalExpression(expr) {
    var clean = expr.replace(/×/g, "*").replace(/÷/g, "/").replace(/,/g, ".");
    if (!/^[0-9+\-*/%^().\s]*$/.test(clean)) throw new Error("Wyrażenie zawiera niedozwolone znaki: " + expr);
    var tokens = clean.match(/\d+(\.\d+)?|[+\-*/%^()]/g) || [];
    var pos = 0;

    function peek() { return tokens[pos]; }
    function next() { return tokens[pos++]; }

    function parseExpr() {
      var left = parseTerm();
      while (peek() === "+" || peek() === "-") {
        var op = next();
        var right = parseTerm();
        left = op === "+" ? left + right : left - right;
      }
      return left;
    }
    function parseTerm() {
      var left = parsePower();
      while (peek() === "*" || peek() === "/" || peek() === "%") {
        var op = next();
        var right = parsePower();
        if (op === "*") left = left * right;
        else if (op === "/") left = right === 0 ? 0 : left / right;
        else left = right === 0 ? 0 : left % right;
      }
      return left;
    }
    function parsePower() {
      var base = parseUnary();
      if (peek() === "^") { next(); return Math.pow(base, parsePower()); }
      return base;
    }
    function parseUnary() {
      if (peek() === "-") { next(); return -parseUnary(); }
      if (peek() === "+") { next(); return parseUnary(); }
      return parseAtom();
    }
    function parseAtom() {
      var token = next();
      if (token === "(") {
        var value = parseExpr();
        if (peek() === ")") next();
        return value;
      }
      var n = parseFloat(token);
      return isNaN(n) ? 0 : n;
    }

    var result = parseExpr();
    return isFinite(result) ? result : 0;
  }

  function formatCustomDate(date, pattern) {
    var pad = function (n) { return n < 10 ? "0" + n : String(n); };
    var map = {
      yyyy: date.getFullYear(), MM: pad(date.getMonth() + 1), dd: pad(date.getDate()),
      HH: pad(date.getHours()), mm: pad(date.getMinutes()), ss: pad(date.getSeconds())
    };
    return (pattern || "yyyy-MM-dd HH:mm").replace(/yyyy|MM|dd|HH|mm|ss/g, function (m) { return map[m]; });
  }

  var LABELS = {
    "is.workflow.actions.conditional": "Jeżeli",
    "is.workflow.actions.repeat.count": "Powtórz",
    "is.workflow.actions.repeat.each": "Powtórz dla każdego",
    "is.workflow.actions.choosefrommenu": "Menu"
  };

  root.actions = {
    /* Najpierw natywna implementacja, a gdy jej nie ma, emulator urządzenia. */
    get: function (id) {
      if (MAP[id]) return MAP[id];
      return root.emulation ? root.emulation.resolve(id) : null;
    },
    define: function (id, spec) { MAP[id] = spec; },
    has: function (id) { return !!MAP[id]; },
    label: function (id) {
      if (MAP[id] && MAP[id].label) return MAP[id].label;
      if (LABELS[id]) return LABELS[id];
      var emulated = root.emulation ? root.emulation.resolve(id) : null;
      if (emulated && emulated.label) return emulated.label;
      return String(id).replace(/^is\.workflow\.actions\./, "");
    },
    count: function () { return Object.keys(MAP).length; },
    ids: function () { return Object.keys(MAP); },
    evalExpression: evalExpression
  };
})(typeof window !== "undefined" ? (window.ShortRun = window.ShortRun || {}) : module.exports);
