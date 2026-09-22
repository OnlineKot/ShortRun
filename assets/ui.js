/* Warstwa interfejsu: wczytywanie skrótu, podgląd kroków, konsola przebiegu
   oraz implementacja wszystkich interakcji, których potrzebuje silnik. */
(function (SR) {
  "use strict";

  var $ = function (id) { return document.getElementById(id); };
  var val = SR.val;
  var SETTINGS_KEY = "shortrun.settings.v1";

  var state = {
    shortcut: null,
    running: false,
    settings: { proxy: "", proxyForRequests: false }
  };

  /* ---------- ustawienia ---------- */

  try {
    var saved = JSON.parse(localStorage.getItem(SETTINGS_KEY) || "{}");
    if (saved && typeof saved === "object") {
      state.settings.proxy = typeof saved.proxy === "string" ? saved.proxy : "";
      state.settings.proxyForRequests = !!saved.proxyForRequests;
    }
  } catch (e) { /* brak lub uszkodzone ustawienia — zostają domyślne */ }

  function saveSettings() {
    try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(state.settings)); } catch (e) { /* tryb prywatny */ }
  }

  /* ---------- komunikaty ---------- */

  function banner(kind, html) {
    $("banner").innerHTML = html ? '<div class="banner ' + kind + '">' + html + "</div>" : "";
  }

  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }

  /* ---------- okna dialogowe ---------- */

  function openDialog(dialog) {
    if (typeof dialog.showModal === "function") dialog.showModal();
    else dialog.setAttribute("open", "");
  }
  function closeDialog(dialog) {
    if (typeof dialog.close === "function") dialog.close();
    else dialog.removeAttribute("open");
  }

  function askDialog(prompt, defaultValue, type) {
    return new Promise(function (resolve) {
      var dialog = $("askDialog");
      $("askMsg").textContent = prompt;
      var input = $("askInput");
      input.type = type === "number" ? "number" : "text";
      input.value = defaultValue || "";
      openDialog(dialog);
      input.focus();

      function done(value) {
        $("askOk").onclick = null;
        $("askCancel").onclick = null;
        input.onkeydown = null;
        closeDialog(dialog);
        resolve(value);
      }
      $("askOk").onclick = function () { done(input.value); };
      $("askCancel").onclick = function () { done(null); };
      input.onkeydown = function (ev) { if (ev.key === "Enter") { ev.preventDefault(); done(input.value); } };
    });
  }

  function chooseDialog(prompt, items, multiple) {
    return new Promise(function (resolve) {
      var dialog = $("chooseDialog");
      $("chooseTitle").textContent = prompt;
      var list = $("chooseList");
      list.innerHTML = "";
      var picked = [];

      items.forEach(function (item, index) {
        var button = document.createElement("button");
        button.type = "button";
        button.textContent = item;
        button.addEventListener("click", function () {
          if (multiple) {
            var at = picked.indexOf(index);
            if (at === -1) picked.push(index); else picked.splice(at, 1);
            button.classList.toggle("picked");
          } else {
            done([index]);
          }
        });
        list.appendChild(button);
      });

      $("chooseOk").style.display = multiple ? "" : "none";
      openDialog(dialog);

      function done(indexes) {
        $("chooseOk").onclick = null;
        $("chooseCancel").onclick = null;
        closeDialog(dialog);
        if (indexes === null) return resolve(null);
        var chosen = indexes.map(function (i) { return items[i]; });
        resolve(multiple ? chosen : chosen[0]);
      }
      $("chooseOk").onclick = function () { done(picked.slice().sort()); };
      $("chooseCancel").onclick = function () { done(null); };
    });
  }

  function showDialog(title, message, cancellable) {
    return new Promise(function (resolve) {
      var dialog = $("showDialog");
      $("showTitle").textContent = title;
      $("showMsg").textContent = message;
      $("showCancel").style.display = cancellable === false ? "none" : "";
      openDialog(dialog);

      function done(value) {
        $("showOk").onclick = null;
        $("showCancel").onclick = null;
        closeDialog(dialog);
        resolve(value);
      }
      $("showOk").onclick = function () { done(true); };
      $("showCancel").onclick = function () { done(false); };
    });
  }

  /* ---------- konsola przebiegu ---------- */

  function logEntry(entry) {
    var box = $("log");
    var row = document.createElement("div");
    row.className = "entry " + (entry.status || "run");
    row.innerHTML = '<div class="t">' + escapeHtml(entry.title || "") + "</div>" +
                    (entry.detail ? '<div class="d">' + escapeHtml(entry.detail) + "</div>" : "");
    box.appendChild(row);
    box.scrollTop = box.scrollHeight;
  }

  /* ---------- implementacja interakcji dla silnika ---------- */

  function proxied(url) {
    var template = state.settings.proxy;
    if (!template) return url;
    return template.indexOf("{url}") !== -1
      ? template.replace("{url}", encodeURIComponent(url))
      : template + encodeURIComponent(url);
  }

  var ui = {
    log: logEntry,
    ask: askDialog,
    choose: chooseDialog,
    show: function (title, message) { return showDialog(title, message); },

    notify: function (title, body) {
      logEntry({ status: "ok", title: "🔔 " + title, detail: body });
      try {
        if (typeof Notification === "function" && Notification.permission === "granted") {
          new Notification(title, { body: body });
        } else if (typeof Notification === "function" && Notification.permission === "default") {
          Notification.requestPermission();
        }
      } catch (e) { /* powiadomienia zablokowane — wpis w logu wystarczy */ }
    },

    speak: function (text, options) {
      try {
        var utterance = new SpeechSynthesisUtterance(text);
        utterance.lang = document.documentElement.lang || "pl-PL";
        utterance.rate = options && options.rate ? options.rate : 1;
        utterance.pitch = options && options.pitch ? options.pitch : 1;
        speechSynthesis.speak(utterance);
      } catch (e) {
        logEntry({ status: "skip", title: "Mowa", detail: "Przeglądarka nie udostępnia syntezatora." });
      }
    },

    copy: function (text) {
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(text).catch(function () { /* brak zgody — schowek silnika i tak jest ustawiony */ });
      }
    },

    open: function (url) {
      if (/^(https?|shortcuts|mailto|tel|sms|maps):/i.test(url)) window.open(url, "_blank", "noopener");
      else logEntry({ status: "skip", title: "Otwórz URL", detail: "Pominięto niebezpieczny adres: " + url });
    },

    request: function (url, options) {
      options = options || {};
      var init = {
        method: options.method || "GET",
        headers: options.headers || {},
        body: options.body || undefined,
        credentials: "omit"
      };
      var direct = fetch(url, init);
      var chain = state.settings.proxyForRequests && state.settings.proxy
        ? direct.catch(function () { return fetch(proxied(url), init); })
        : direct;

      return chain.then(function (res) {
        var type = res.headers.get("content-type") || "";
        return res.text().then(function (text) {
          if (type.indexOf("json") !== -1) {
            try { return JSON.parse(text); } catch (e) { return text; }
          }
          return text;
        });
      }).catch(function (err) {
        throw new Error("Zapytanie nie powiodło się (" + err.message + "). Zwykle to CORS — włącz proxy w Ustawieniach.");
      });
    },

    location: function () {
      return new Promise(function (resolve) {
        if (!navigator.geolocation) return resolve("");
        navigator.geolocation.getCurrentPosition(function (pos) {
          resolve({
            latitude: pos.coords.latitude,
            longitude: pos.coords.longitude,
            accuracy: pos.coords.accuracy
          });
        }, function () { resolve(""); }, { timeout: 10000 });
      });
    },

    battery: function () {
      if (!navigator.getBattery) return Promise.resolve("");
      return navigator.getBattery().then(function (b) { return Math.round(b.level * 100); }, function () { return ""; });
    },

    device: function (detail) {
      var map = {
        "Device Name": navigator.platform || "Przeglądarka",
        "Device Model": navigator.platform || "Przeglądarka",
        "System Version": navigator.appVersion || "",
        "Device Hostname": location.hostname,
        "Current Volume": ""
      };
      return map[detail] !== undefined ? map[detail] : navigator.userAgent;
    },

    vibrate: function () { if (navigator.vibrate) navigator.vibrate(200); },

    base64Encode: function (text) {
      return btoa(unescape(encodeURIComponent(text)));
    },
    base64Decode: function (text) {
      try { return decodeURIComponent(escape(atob(text))); } catch (e) { return ""; }
    }
  };

  /* ---------- podgląd kroków ---------- */

  function renderShortcut(shortcut) {
    state.shortcut = shortcut;
    var actions = shortcut.WFWorkflowActions || [];
    var meta = shortcut.__meta || {};
    var missing = [];

    var list = $("steps");
    list.innerHTML = "";
    var depth = 0;

    actions.forEach(function (action, index) {
      var id = action.WFWorkflowActionIdentifier || "";
      var params = action.WFWorkflowActionParameters || {};
      var flow = params.WFControlFlowMode;
      var isFlow = flow !== undefined;
      if (isFlow && (flow === 1 || flow === 2)) depth = Math.max(0, depth - 1);

      var li = document.createElement("li");
      li.dataset.depth = String(Math.min(2, depth));
      var native = SR.actions.has(id) || isFlow;
      if (!native) missing.push(id);
      li.className = native ? (isFlow ? "flow" : "") : "emulated";
      li.innerHTML = '<span class="idx">' + (index + 1) + "</span>" +
                     '<span class="name">' + escapeHtml(SR.actions.label(id)) +
                     (isFlow ? " " + (flow === 0 ? "▸ początek" : flow === 1 ? "▸ inaczej" : "▸ koniec") : "") +
                     "</span>";
      list.appendChild(li);

      if (isFlow && (flow === 0 || flow === 1)) depth++;
    });

    var unique = missing.filter(function (id, i) { return missing.indexOf(id) === i; });
    $("meta").innerHTML =
      '<span class="pill">' + escapeHtml(meta.name || "Skrót bez nazwy") + "</span>" +
      '<span class="pill">' + actions.length + " akcji</span>" +
      (unique.length
        ? '<span class="pill emul">' + unique.length + " emulowanych</span>"
        : '<span class="pill good">wszystkie akcje natywne</span>');

    $("infoCard").hidden = false;
    if (meta.name) $("deviceName").value = meta.name;
  }

  /* ---------- panel wirtualnego urządzenia ---------- */

  function group(title, rows) {
    if (!rows.length) return "";
    return '<div class="dev-group"><h3>' + escapeHtml(title) + "</h3><table><tbody>" +
      rows.map(function (row) {
        return "<tr><td>" + escapeHtml(row[0]) + "</td><td>" + escapeHtml(row[1]) + "</td></tr>";
      }).join("") + "</tbody></table></div>";
  }

  function renderDevice(device) {
    if (!device) return;
    var html = "";

    html += group("Urządzenie", [
      ["model", device.model],
      ["system", device.system],
      ["bateria", device.battery + "%"]
    ]);

    html += group("Zdrowie", device.health.map(function (entry) {
      return [entry.typ, entry.wartość + (entry.jednostka ? " " + entry.jednostka : "")];
    }).concat(device.workouts.map(function (workout) {
      return ["trening: " + workout.typ, workout["czas trwania"] + " min, " + workout.kcal + " kcal"];
    })));

    html += group("Dom", Object.keys(device.home).map(function (name) {
      var accessory = device.home[name];
      return [name, accessory.stan + (accessory.temperatura ? ", " + accessory.temperatura + "°C" : "")];
    }));

    html += group("Ustawienia", Object.keys(device.settings).map(function (name) {
      var value = device.settings[name];
      if (typeof value === "boolean") return [name, value ? "włączone" : "wyłączone"];
      if (typeof value === "number") return [name, Math.round(value * 100) + "%"];
      return [name, String(value)];
    }));

    html += group("Media", [[device.media.odtwarzanie ? "odtwarza" : "zatrzymane", device.media.utwór]]);

    html += group("Wysłane", device.messages.map(function (m) { return ["wiadomość do " + m.do, m.treść]; })
      .concat(device.mails.map(function (m) { return ["e-mail do " + m.do, m.temat]; })));

    html += group("Kalendarz i listy", device.events.map(function (e) { return ["wydarzenie", e.tytuł]; })
      .concat(device.reminders.map(function (r) { return ["przypomnienie", r.tytuł]; }))
      .concat(device.notes.map(function (n) { return ["notatka", n.treść]; })));

    html += group("Pliki", Object.keys(device.files).map(function (path) {
      return [path, val.toText(device.files[path]).slice(0, 60)];
    }));

    html += group("Zdjęcia", device.photos.slice(-4).map(function (photo) { return [photo.nazwa, photo.data]; }));

    html += group("Dziennik emulacji", device.log.map(function (entry) { return [entry.kind, entry.text]; }));

    $("device").innerHTML = html || '<p class="dev-empty">Skrót nie dotknął żadnej funkcji systemowej.</p>';
    $("deviceCard").hidden = false;
  }

  /* ---------- wykonanie ---------- */

  function runShortcut() {
    if (!state.shortcut || state.running) return;
    state.running = true;
    $("runAgain").disabled = true;
    $("stopRun").disabled = false;
    $("log").innerHTML = "";
    $("logCard").hidden = false;
    $("outCard").hidden = true;
    $("deviceCard").hidden = true;
    SR.emulation.reset();

    var started = Date.now();
    SR.engine.run(state.shortcut, ui, { input: $("input").value }).then(function (result) {
      var text = val.toText(result.output);
      $("out").textContent = text === "" ? "(skrót nie zwrócił wartości)" : text;
      $("outCard").hidden = false;
      var seconds = ((Date.now() - started) / 1000).toFixed(1);
      renderDevice(result.device);
      var emulated = result.emulated.filter(function (id, i) { return result.emulated.indexOf(id) === i; });
      if (emulated.length) {
        banner("info", "Skrót wykonany w " + seconds + " s. " + emulated.length +
          " akcji systemowych odegrano na wirtualnym urządzeniu: <code>" +
          emulated.map(function (id) { return escapeHtml(SR.actions.label(id)); }).join("</code>, <code>") +
          "</code>. Stan urządzenia widać w panelu niżej.");
      } else {
        banner("ok", "Skrót wykonany w " + seconds + " s, wszystkie akcje natywnie.");
      }
    }, function (err) {
      logEntry({ status: "error", title: "Przerwano", detail: err && err.message ? err.message : String(err) });
      banner("err", "Wykonanie przerwane: " + escapeHtml(err && err.message ? err.message : String(err)));
    }).then(function () {
      state.running = false;
      $("runAgain").disabled = false;
      $("stopRun").disabled = true;
    });
  }

  function loadFrom(promise, andRun) {
    banner("info", "Wczytuję skrót…");
    return promise.then(function (shortcut) {
      renderShortcut(shortcut);
      banner("ok", "Wczytano „" + escapeHtml((shortcut.__meta && shortcut.__meta.name) || "skrót") + "”.");
      if (andRun) runShortcut();
    }, function (err) {
      var message = err && err.message ? err.message : String(err);
      if (err && err.code === "AEA") {
        message += " Wyeksportuj skrót do pliku na Macu (Plik → Eksportuj) albo wklej definicję ręcznie.";
      } else if (/Failed to fetch|NetworkError|Load failed/i.test(message)) {
        message = "Nie udało się pobrać skrótu z iCloud — najpewniej blokada CORS. " +
                  "Ustaw proxy w Ustawieniach albo wczytaj plik skrótu z dysku.";
      }
      banner("err", escapeHtml(message));
    });
  }

  /* ---------- zdarzenia ---------- */

  $("loadRun").addEventListener("click", function () {
    loadFrom(SR.loader.fromICloud($("link").value, { proxy: state.settings.proxy }), true);
  });

  $("loadOnly").addEventListener("click", function () {
    loadFrom(SR.loader.fromICloud($("link").value, { proxy: state.settings.proxy }), false);
  });

  $("runAgain").addEventListener("click", runShortcut);

  $("stopRun").addEventListener("click", function () {
    SR.engine.stop();
    logEntry({ status: "skip", title: "Zatrzymano", detail: "Przerwane ręcznie." });
  });

  $("pickFile").addEventListener("click", function () { $("file").click(); });

  $("file").addEventListener("change", function () {
    var file = $("file").files && $("file").files[0];
    if (file) loadFrom(SR.loader.fromFile(file), true);
    $("file").value = "";
  });

  $("pastePlist").addEventListener("click", function () {
    var dialog = $("pasteDialog");
    openDialog(dialog);
    $("pasteOk").onclick = function () {
      closeDialog(dialog);
      loadFrom(SR.loader.fromText($("pasteText").value), true);
    };
    $("pasteCancel").onclick = function () { closeDialog(dialog); };
  });

  $("settings").addEventListener("click", function () {
    var dialog = $("settingsDialog");
    $("proxy").value = state.settings.proxy;
    $("proxyForRequests").checked = state.settings.proxyForRequests;
    openDialog(dialog);
    $("settingsSave").onclick = function () {
      state.settings.proxy = $("proxy").value.trim();
      state.settings.proxyForRequests = $("proxyForRequests").checked;
      saveSettings();
      closeDialog(dialog);
      banner("ok", "Ustawienia zapisane.");
    };
    $("settingsClose").onclick = function () { closeDialog(dialog); };
  });

  $("copyOut").addEventListener("click", function () {
    ui.copy($("out").textContent);
    banner("ok", "Skopiowano wynik do schowka.");
  });

  /* ---------- uruchomienie na urządzeniu ---------- */

  var isApple = /iPad|iPhone|iPod|Macintosh/.test(navigator.userAgent) ||
                (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);

  function deviceOnly() {
    if (isApple) return false;
    banner("warn", "Schemat <code>shortcuts://</code> obsługują tylko iOS, iPadOS i macOS.");
    return true;
  }

  $("deviceRun").addEventListener("click", function () {
    var name = $("deviceName").value.trim();
    if (!name) { banner("err", "Podaj nazwę skrótu z aplikacji Skróty."); return; }
    if (deviceOnly()) return;
    var back = location.origin + location.pathname;
    var url = "shortcuts://x-callback-url/run-shortcut?name=" + encodeURIComponent(name) +
              "&input=text&text=" + encodeURIComponent($("input").value) +
              "&x-success=" + encodeURIComponent(back + "?done=" + encodeURIComponent(name)) +
              "&x-error=" + encodeURIComponent(back + "?failed=" + encodeURIComponent(name));
    window.location.href = url;
  });

  $("deviceImport").addEventListener("click", function () {
    var id = SR.loader.idFromLink($("link").value);
    if (!id) { banner("err", "Najpierw wklej link iCloud do skrótu."); return; }
    if (deviceOnly()) return;
    window.location.href = "shortcuts://import-shortcut?url=" +
      encodeURIComponent("https://www.icloud.com/shortcuts/" + id);
  });

  /* ---------- parametry adresu ---------- */

  (function start() {
    var q = new URLSearchParams(location.search);
    var link = q.get("shortcut") || q.get("link");
    var input = q.get("input");
    if (input) $("input").value = input;
    if (q.get("done")) banner("ok", "Skrót „" + escapeHtml(q.get("done")) + "” zakończył się na urządzeniu.");
    if (q.get("failed")) banner("err", "Skrót „" + escapeHtml(q.get("failed")) + "” nie zadziałał na urządzeniu.");
    if (link) {
      $("link").value = link;
      loadFrom(SR.loader.fromICloud(link, { proxy: state.settings.proxy }), q.get("run") !== "0");
    }
  })();
})(window.ShortRun);
