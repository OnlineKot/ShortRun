/* Silnik wykonujący skróty Apple w przeglądarce.
   Odpowiada za: konwersje typów, rozwijanie zmiennych (także magicznych),
   parsowanie bloków sterujących i pętlę wykonania. */
(function (root) {
  "use strict";

  var OBJ_REPLACEMENT = "￼"; // znacznik załącznika wewnątrz WFTextTokenString

  /* ---------- konwersje ---------- */

  function isDict(v) {
    return v !== null && typeof v === "object" && !Array.isArray(v) && !(v instanceof Date) && !(v instanceof Uint8Array);
  }

  function toText(v) {
    if (v === null || v === undefined) return "";
    if (typeof v === "string") return v;
    if (typeof v === "number" || typeof v === "boolean") return String(v);
    if (v instanceof Date) return v.toLocaleString();
    if (Array.isArray(v)) return v.map(toText).join("\n");
    if (v instanceof Uint8Array) return "[" + v.length + " B danych]";
    try {
      return JSON.stringify(v, null, 2);
    } catch (e) {
      return String(v);
    }
  }

  function toNumber(v) {
    if (typeof v === "number") return v;
    if (typeof v === "boolean") return v ? 1 : 0;
    if (v instanceof Date) return v.getTime();
    if (Array.isArray(v)) return v.length;
    var n = parseFloat(String(toText(v)).replace(/[^0-9eE+\-.,]/g, "").replace(",", "."));
    return isNaN(n) ? 0 : n;
  }

  function toList(v) {
    if (Array.isArray(v)) return v.slice();
    if (v === null || v === undefined || v === "") return [];
    if (typeof v === "string" && v.indexOf("\n") !== -1) return v.split("\n");
    return [v];
  }

  function toDict(v) {
    if (isDict(v)) return v;
    if (typeof v === "string") {
      try {
        var parsed = JSON.parse(v);
        if (isDict(parsed) || Array.isArray(parsed)) return parsed;
      } catch (e) { /* nie JSON — niżej */ }
    }
    return {};
  }

  function typeName(v) {
    if (Array.isArray(v)) return "lista (" + v.length + ")";
    if (v instanceof Date) return "data";
    if (v instanceof Uint8Array) return "dane";
    if (isDict(v)) return "słownik";
    if (v === null || v === undefined) return "brak";
    return typeof v === "number" ? "liczba" : typeof v === "boolean" ? "prawda/fałsz" : "tekst";
  }

  /* ---------- kontekst wykonania ---------- */

  function Context(ui, input) {
    this.ui = ui;
    this.vars = {};          // zmienne nazwane
    this.outputs = {};       // wyniki akcji wg UUID (zmienne magiczne)
    this.input = input === undefined ? "" : input;
    this.last = this.input;
    this.clipboard = "";
    this.output = null;
    this.stopped = false;
    this.unsupported = [];
  }

  Context.prototype.setVar = function (name, value) {
    if (name) this.vars[String(name)] = value;
  };

  Context.prototype.getVar = function (name) {
    var key = String(name);
    if (Object.prototype.hasOwnProperty.call(this.vars, key)) return this.vars[key];
    var special = this.specialVar(key);
    return special === undefined ? "" : special;
  };

  Context.prototype.specialVar = function (name) {
    switch (name) {
      case "Shortcut Input":
      case "Wejście skrótu":
      case "ExtensionInput": return this.input;
      case "Clipboard":
      case "Schowek": return this.clipboard;
      case "Current Date":
      case "Bieżąca data": return new Date();
      case "Ask Each Time": return "";
      default: return undefined;
    }
  };

  /* ---------- rozwijanie parametrów ---------- */

  function resolveParam(param, ctx) {
    if (param === null || param === undefined) return Promise.resolve(param);
    if (typeof param !== "object") return Promise.resolve(param);
    if (param instanceof Date || param instanceof Uint8Array) return Promise.resolve(param);

    if (Array.isArray(param)) return mapSeries(param, function (item) { return resolveParam(item, ctx); });

    var kind = param.WFSerializationType;
    if (kind === "WFTextTokenString") return resolveTokenString(param.Value, ctx);
    if (kind === "WFTextTokenAttachment") return resolveAttachment(param.Value, ctx);
    if (kind === "WFDictionaryFieldValue") return resolveDictionaryField(param.Value, ctx);
    if (kind === "WFArrayParameterState") return resolveParam(param.Value, ctx);
    if (kind === "WFNumberSubstitutableState") {
      return resolveParam(param.Value, ctx).then(function (v) { return toNumber(v); });
    }
    if (kind) return resolveParam(param.Value, ctx);

    // zwykły słownik z literałami — rozwijamy rekurencyjnie
    var keys = Object.keys(param);
    var out = {};
    return mapSeries(keys, function (key) {
      return resolveParam(param[key], ctx).then(function (v) { out[key] = v; });
    }).then(function () { return out; });
  }

  function resolveTokenString(value, ctx) {
    if (!value) return Promise.resolve("");
    if (typeof value === "string") return Promise.resolve(value);
    var text = value.string || "";
    var byRange = value.attachmentsByRange || {};

    var spots = Object.keys(byRange).map(function (range) {
      var m = /\{(\d+),\s*(\d+)\}/.exec(range);
      return {
        start: m ? parseInt(m[1], 10) : 0,
        len: m ? parseInt(m[2], 10) : 1,
        attachment: byRange[range]
      };
    }).sort(function (a, b) { return b.start - a.start; }); // od końca, żeby indeksy zostały ważne

    return mapSeries(spots, function (spot) {
      return resolveAttachment(spot.attachment, ctx).then(function (v) { spot.value = v; });
    }).then(function () {
      // Zakresy są liczone dla oryginalnego tekstu, więc podstawiamy od końca.
      // Gdy liczba znaczników ￼ zgadza się z liczbą załączników, ufamy ich
      // kolejności — to odporniejsze na rozjechane indeksy w starszych plikach.
      var marks = [];
      for (var i = 0; i < text.length; i++) {
        if (text.charAt(i) === OBJ_REPLACEMENT) marks.push(i);
      }
      var ordered = spots.slice().sort(function (a, b) { return a.start - b.start; });
      if (marks.length === ordered.length) {
        ordered.forEach(function (spot, index) { spot.start = marks[index]; spot.len = 1; });
      }

      var out = text;
      ordered.slice().reverse().forEach(function (spot) {
        var len = out.charAt(spot.start) === OBJ_REPLACEMENT ? 1 : spot.len;
        out = out.slice(0, spot.start) + toText(spot.value) + out.slice(spot.start + len);
      });
      return out;
    });
  }

  function resolveAttachment(att, ctx) {
    if (!att) return Promise.resolve("");
    if (att.WFSerializationType) return resolveParam(att, ctx);

    var base;
    switch (att.Type) {
      case "Variable": base = Promise.resolve(ctx.getVar(att.VariableName)); break;
      case "ActionOutput": base = Promise.resolve(ctx.outputs[att.OutputUUID]); break;
      case "ExtensionInput":
      case "ShortcutInput": base = Promise.resolve(ctx.input); break;
      case "Clipboard": base = Promise.resolve(ctx.clipboard); break;
      case "CurrentDate": base = Promise.resolve(new Date()); break;
      case "Ask":
        base = ctx.ui.ask(att.Prompt || "Podaj wartość", "", "text");
        break;
      case "DeviceDetails": base = Promise.resolve(navigatorName()); break;
      default:
        base = Promise.resolve(att.VariableName ? ctx.getVar(att.VariableName) : "");
    }

    return base.then(function (value) {
      return applyAggrandizements(value, att.Aggrandizements || [], ctx);
    });
  }

  function applyAggrandizements(value, list, ctx) {
    return mapSeries(list, function (ag) {
      var type = ag.Type;
      if (type === "WFDictionaryValueVariableAggrandizement") {
        return resolveParam(ag.DictionaryKey, ctx).then(function (key) {
          var dict = toDict(value);
          value = dict[toText(key)];
        });
      }
      if (type === "WFCoercionVariableAggrandizement") {
        var cls = ag.CoercionItemClass;
        if (cls === "WFStringContentItem") value = toText(value);
        else if (cls === "WFNumberContentItem") value = toNumber(value);
        else if (cls === "WFDictionaryContentItem") value = toDict(value);
        else if (cls === "WFArrayContentItem") value = toList(value);
        return null;
      }
      if (type === "WFPropertyVariableAggrandizement") {
        var name = ag.PropertyName;
        if (name === "Name" || name === "Nazwa") value = toText(value);
        else if (isDict(value)) value = value[name];
        else if (Array.isArray(value) && name === "Count") value = value.length;
        return null;
      }
      return null;
    }).then(function () { return value; });
  }

  function resolveDictionaryField(value, ctx) {
    var items = (value && value.Value && value.Value.WFDictionaryFieldValueItems) ||
                (value && value.WFDictionaryFieldValueItems) || [];
    var out = {};
    return mapSeries(items, function (item) {
      var key, val;
      return resolveParam(item.WFKey, ctx)
        .then(function (k) { key = toText(k); return resolveParam(item.WFValue, ctx); })
        .then(function (v) {
          // WFItemType: 0 tekst, 1 liczba, 2 tablica, 3 słownik, 4 prawda/fałsz
          if (item.WFItemType === 1) v = toNumber(v);
          else if (item.WFItemType === 4) v = !!v && v !== "false";
          out[key] = v;
        });
    }).then(function () { return out; });
  }

  function navigatorName() {
    return typeof navigator !== "undefined" ? navigator.userAgent : "Przeglądarka";
  }

  /* ---------- narzędzia asynchroniczne ---------- */

  function mapSeries(list, fn) {
    var out = [];
    return list.reduce(function (chain, item, index) {
      return chain.then(function () {
        return Promise.resolve(fn(item, index)).then(function (v) { out.push(v); });
      });
    }, Promise.resolve()).then(function () { return out; });
  }

  /* ---------- parsowanie bloków sterujących ---------- */

  var CONTROL = {
    "is.workflow.actions.conditional": "if",
    "is.workflow.actions.repeat.count": "repeat",
    "is.workflow.actions.repeat.each": "repeatEach",
    "is.workflow.actions.choosefrommenu": "menu"
  };

  function parseBlocks(actions) {
    var index = 0;

    function parseList(stopAtEnd) {
      var nodes = [];
      while (index < actions.length) {
        var action = actions[index];
        var id = action.WFWorkflowActionIdentifier;
        var params = action.WFWorkflowActionParameters || {};
        var control = CONTROL[id];
        var mode = params.WFControlFlowMode;

        if (control && mode === 0) {
          index++;
          var node = { type: control, action: action, params: params, branches: [] };
          if (control === "if") {
            node.branches.push({ label: "then", body: parseList(true) });
            while (isBranchSplit(actions[index], id)) {
              index++;
              node.branches.push({ label: "else", body: parseList(true) });
            }
          } else if (control === "menu") {
            while (isBranchSplit(actions[index], id)) {
              var item = actions[index].WFWorkflowActionParameters || {};
              index++;
              node.branches.push({ label: item.WFMenuItemTitle, body: parseList(true) });
            }
          } else {
            node.branches.push({ label: "body", body: parseList(true) });
          }
          expectEnd(id, node);
          nodes.push(node);
          continue;
        }

        if (control && (mode === 1 || mode === 2)) {
          if (!stopAtEnd) { index++; continue; } // osierocony znacznik — pomijamy
          return nodes;
        }

        index++;
        nodes.push({ type: "action", action: action, params: params });
      }
      return nodes;
    }

    function isBranchSplit(action, id) {
      if (!action) return false;
      var p = action.WFWorkflowActionParameters || {};
      return action.WFWorkflowActionIdentifier === id && p.WFControlFlowMode === 1;
    }

    function expectEnd(id, node) {
      var action = actions[index];
      if (action && action.WFWorkflowActionIdentifier === id &&
          (action.WFWorkflowActionParameters || {}).WFControlFlowMode === 2) {
        node.endParams = action.WFWorkflowActionParameters || {};
        index++;
      }
    }

    return parseList(false);
  }

  /* ---------- wykonanie ---------- */

  function run(shortcut, ui, options) {
    options = options || {};
    var actions = (shortcut && shortcut.WFWorkflowActions) || [];
    var ctx = new Context(ui, options.input);
    var tree = parseBlocks(actions);
    root.engine.current = ctx;

    return execList(tree, ctx).then(finish, function (err) {
      if (err && err.__stop) return finish();
      throw err;
    });

    function finish() {
      return {
        output: ctx.output !== null && ctx.output !== undefined ? ctx.output : ctx.last,
        unsupported: ctx.unsupported,
        vars: ctx.vars
      };
    }
  }

  function execList(nodes, ctx) {
    return mapSeries(nodes, function (node) {
      if (ctx.stopped) return null;
      return execNode(node, ctx);
    }).then(function () { return ctx.last; });
  }

  function execNode(node, ctx) {
    if (node.type === "action") return execAction(node, ctx);
    if (node.type === "if") return execIf(node, ctx);
    if (node.type === "repeat") return execRepeat(node, ctx);
    if (node.type === "repeatEach") return execRepeatEach(node, ctx);
    if (node.type === "menu") return execMenu(node, ctx);
    return Promise.resolve();
  }

  function execAction(node, ctx) {
    var id = node.action.WFWorkflowActionIdentifier || "";
    var impl = root.actions.get(id);
    var label = root.actions.label(id);

    if (!impl) {
      ctx.unsupported.push(id);
      ctx.ui.log({ status: "skip", title: label, detail: "Akcja nieobsługiwana w symulatorze — pomijam, wejście przechodzi dalej." });
      return Promise.resolve();
    }

    return resolveParam(node.params, ctx).then(function (params) {
      ctx.ui.log({ status: "run", title: label, detail: impl.describe ? impl.describe(params, ctx) : "" });
      return impl.run(params, ctx, node);
    }).then(function (result) {
      if (result !== undefined) {
        ctx.last = result;
        if (node.params && node.params.UUID) ctx.outputs[node.params.UUID] = result;
        ctx.ui.log({ status: "ok", title: label, detail: preview(result) });
      } else {
        ctx.ui.log({ status: "ok", title: label, detail: "" });
      }
    }, function (err) {
      if (err && err.__stop) throw err;
      ctx.ui.log({ status: "error", title: label, detail: err && err.message ? err.message : String(err) });
      throw err;
    });
  }

  function preview(value) {
    var text = toText(value);
    return typeName(value) + (text ? " · " + (text.length > 160 ? text.slice(0, 160) + "…" : text) : "");
  }

  /* Kody warunków z plistów Skrótów. Nieznany kod traktujemy jak „równe”. */
  var CONDITIONS = {
    0: "lt", 1: "lte", 2: "gt", 3: "gte", 4: "eq", 5: "neq",
    8: "beginsWith", 9: "endsWith", 99: "contains", 999: "notContains",
    100: "hasValue", 101: "noValue", 1003: "between",
    "Equals": "eq", "Is": "eq", "Is Not": "neq", "Does Not Equal": "neq",
    "Contains": "contains", "Does Not Contain": "notContains",
    "Begins With": "beginsWith", "Ends With": "endsWith",
    "Is Greater Than": "gt", "Is Less Than": "lt",
    "Is Greater Than or Equal To": "gte", "Is Less Than or Equal To": "lte",
    "Has Any Value": "hasValue", "Does Not Have Any Value": "noValue"
  };

  function compare(left, op, right, right2) {
    var lt = toText(left), rt = toText(right);
    var ln = toNumber(left), rn = toNumber(right);
    var numeric = lt !== "" && rt !== "" && !isNaN(parseFloat(lt)) && !isNaN(parseFloat(rt));
    switch (op) {
      case "eq": return numeric ? ln === rn : lt === rt;
      case "neq": return numeric ? ln !== rn : lt !== rt;
      case "gt": return ln > rn;
      case "gte": return ln >= rn;
      case "lt": return ln < rn;
      case "lte": return ln <= rn;
      case "contains": return lt.indexOf(rt) !== -1;
      case "notContains": return lt.indexOf(rt) === -1;
      case "beginsWith": return lt.indexOf(rt) === 0;
      case "endsWith": return lt.length >= rt.length && lt.slice(lt.length - rt.length) === rt;
      case "hasValue": return lt !== "";
      case "noValue": return lt === "";
      case "between": return ln >= rn && ln <= toNumber(right2);
      default: return lt === rt;
    }
  }

  function execIf(node, ctx) {
    return resolveParam(node.params, ctx).then(function (params) {
      var op = CONDITIONS[params.WFCondition] || "eq";
      var right = params.WFConditionalActionString !== undefined
        ? params.WFConditionalActionString
        : params.WFNumberValue;
      var left = params.WFInput !== undefined && params.WFInput !== null ? params.WFInput : ctx.last;
      var result = compare(left, op, right, params.WFAnotherNumber);
      ctx.ui.log({
        status: "run",
        title: "Jeżeli",
        detail: '„' + toText(left) + '” ' + op + ' „' + toText(right) + '” → ' + (result ? "spełnione" : "niespełnione")
      });
      var branch = result ? node.branches[0] : node.branches[1];
      return branch ? execList(branch.body, ctx) : null;
    });
  }

  function execRepeat(node, ctx) {
    return resolveParam(node.params, ctx).then(function (params) {
      var count = Math.max(0, Math.min(1000, Math.floor(toNumber(params.WFRepeatCount))));
      ctx.ui.log({ status: "run", title: "Powtórz", detail: count + "×" });
      var results = [];
      var body = node.branches[0] ? node.branches[0].body : [];
      var chain = Promise.resolve();
      for (var i = 1; i <= count; i++) {
        (function (iteration) {
          chain = chain.then(function () {
            if (ctx.stopped) return null;
            ctx.setVar("Repeat Index", iteration);
            return execList(body, ctx).then(function (v) { results.push(v); });
          });
        })(i);
      }
      return chain.then(function () { return results; });
    });
  }

  function execRepeatEach(node, ctx) {
    return resolveParam(node.params, ctx).then(function (params) {
      var list = toList(params.WFInput !== undefined && params.WFInput !== null ? params.WFInput : ctx.last);
      ctx.ui.log({ status: "run", title: "Powtórz dla każdego", detail: list.length + " elem." });
      var results = [];
      var body = node.branches[0] ? node.branches[0].body : [];
      return list.reduce(function (chain, item, i) {
        return chain.then(function () {
          if (ctx.stopped) return null;
          ctx.setVar("Repeat Item", item);
          ctx.setVar("Repeat Index", i + 1);
          ctx.last = item;
          return execList(body, ctx).then(function (v) { results.push(v); });
        });
      }, Promise.resolve()).then(function () { return results; });
    });
  }

  function execMenu(node, ctx) {
    return resolveParam(node.params, ctx).then(function (params) {
      var titles = node.branches.map(function (b, i) { return toText(b.label) || "Opcja " + (i + 1); });
      var prompt = toText(params.WFMenuPrompt) || "Wybierz";
      return ctx.ui.choose(prompt, titles, false).then(function (choice) {
        var picked = titles.indexOf(toText(Array.isArray(choice) ? choice[0] : choice));
        if (picked < 0) picked = 0;
        ctx.ui.log({ status: "run", title: "Menu", detail: titles[picked] });
        var branch = node.branches[picked];
        return branch ? execList(branch.body, ctx) : null;
      });
    });
  }

  root.engine = {
    run: run,
    /* Zatrzymanie z zewnątrz: pętla wykonania sprawdza flagę przed każdą akcją. */
    stop: function () {
      if (root.engine.current) root.engine.current.stopped = true;
    },
    current: null,
    parseBlocks: parseBlocks,
    resolveParam: resolveParam,
    compare: compare,
    Context: Context
  };
  root.val = {
    toText: toText, toNumber: toNumber, toList: toList, toDict: toDict,
    isDict: isDict, typeName: typeName, mapSeries: mapSeries
  };
})(typeof window !== "undefined" ? (window.ShortRun = window.ShortRun || {}) : module.exports);
