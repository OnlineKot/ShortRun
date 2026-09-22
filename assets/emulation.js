/* Warstwa emulacji systemu Apple.
   Akcji sięgających do Zdrowia, Domu, mediów czy ustawień przeglądarka nie wykona,
   więc ShortRun prowadzi wirtualne urządzenie: akcja zmienia jego stan i zwraca
   wiarygodną wartość, a przebieg oznacza taki krok jako emulowany. */
(function (root) {
  "use strict";

  var V = root.val;
  var toText = V.toText, toNumber = V.toNumber, toList = V.toList, toDict = V.toDict;

  function freshDevice() {
    return {
      name: "iPhone (wirtualny)",
      model: "iPhone 15 Pro",
      system: "iOS 18.2",
      battery: 76,
      charging: false,
      health: [],
      workouts: [],
      home: {
        "Lampa w salonie": { typ: "światło", stan: "wyłączone", jasność: 60 },
        "Termostat": { typ: "ogrzewanie", stan: "włączone", temperatura: 21 },
        "Zamek drzwi": { typ: "zamek", stan: "zamknięty" },
        "Rolety": { typ: "roleta", stan: "otwarte" }
      },
      scenes: ["Dzień dobry", "Dobranoc", "Wychodzę", "Film"],
      settings: {
        głośność: 0.6, jasność: 0.7, "Wi-Fi": true, Bluetooth: true,
        "Tryb samolotowy": false, "Nie przeszkadzać": false,
        "Tryb niskiego zużycia energii": false, Latarka: false, "Wygląd": "ciemny"
      },
      media: { odtwarzanie: false, utwór: "Nic nie gra", wykonawca: "" },
      messages: [],
      mails: [],
      events: [],
      reminders: [],
      notes: [],
      photos: [
        { nazwa: "IMG_4821.HEIC", data: "2026-09-14", album: "Ostatnie" },
        { nazwa: "IMG_4822.HEIC", data: "2026-09-18", album: "Ostatnie" },
        { nazwa: "IMG_4823.HEIC", data: "2026-09-21", album: "Ostatnie" }
      ],
      files: { "Skróty/notatki.txt": "Przykładowa zawartość pliku.", "Pobrane/raport.pdf": "[PDF 214 kB]" },
      contacts: [
        { imię: "Marta", nazwisko: "Kowalska", telefon: "+48 601 000 111" },
        { imię: "Jakub", nazwisko: "Nowak", telefon: "+48 602 222 333" }
      ],
      apps: [],
      log: []
    };
  }

  var device = freshDevice();

  function reset() {
    device = freshDevice();
    return device;
  }

  function note(kind, text) {
    device.log.push({ kind: kind, text: text, at: new Date() });
  }

  /* ---------- dane syntetyczne ---------- */

  var HEALTH_DEFAULTS = {
    "Steps": { value: 8412, unit: "kroki" },
    "Kroki": { value: 8412, unit: "kroki" },
    "Heart Rate": { value: 68, unit: "uderzenia/min" },
    "Tętno": { value: 68, unit: "uderzenia/min" },
    "Active Energy": { value: 512, unit: "kcal" },
    "Body Mass": { value: 74.5, unit: "kg" },
    "Masa ciała": { value: 74.5, unit: "kg" },
    "Sleep Analysis": { value: 7.4, unit: "h" },
    "Water": { value: 1.8, unit: "l" },
    "Blood Oxygen": { value: 97, unit: "%" },
    "Walking + Running Distance": { value: 6.3, unit: "km" }
  };

  function healthSample(type) {
    var known = HEALTH_DEFAULTS[type];
    if (known) return { typ: type, wartość: known.value, jednostka: known.unit, data: new Date().toISOString() };
    return { typ: type || "Próbka zdrowia", wartość: 42, jednostka: "", data: new Date().toISOString() };
  }

  var WEATHER = {
    warunki: "Częściowe zachmurzenie",
    temperatura: 18,
    "temperatura odczuwalna": 17,
    wilgotność: 62,
    "prędkość wiatru": 11,
    lokalizacja: "Kraków",
    "wschód słońca": "06:41",
    "zachód słońca": "19:12"
  };

  /* ---------- reguły emulacji ---------- */

  var RULES = [];

  function rule(match, label, run) {
    RULES.push({ match: match, label: label, run: run });
  }

  function input(params, ctx) {
    var value = params.WFInput;
    if (value === undefined || value === null || value === "") return ctx.last;
    return value;
  }

  /* Zdrowie */
  rule(/health\.(quantity|sample|category)\.(log|add)/, "Zapisz próbkę w Zdrowiu", function (p, ctx) {
    var entry = {
      typ: toText(p.WFQuantitySampleType || p.WFCategorySampleType || "Kroki"),
      wartość: p.WFQuantitySampleQuantity !== undefined ? toNumber(p.WFQuantitySampleQuantity) : toNumber(input(p, ctx)),
      jednostka: toText(p.WFQuantitySampleUnit || ""),
      data: new Date().toISOString()
    };
    device.health.push(entry);
    note("Zdrowie", "zapisano " + entry.wartość + " " + entry.jednostka + " (" + entry.typ + ")");
    return entry;
  });

  rule(/health\.(quantity|sample|category)/, "Pobierz próbki ze Zdrowia", function (p, ctx) {
    var type = toText(p.WFQuantitySampleType || p.WFHealthSampleType || "Kroki");
    var stored = device.health.filter(function (e) { return e.typ === type; });
    var result = stored.length ? stored : [healthSample(type)];
    note("Zdrowie", "odczytano " + result.length + " próbek (" + type + ")");
    return result.length === 1 ? result[0] : result;
  });

  rule(/health\.workout/, "Trening", function (p, ctx) {
    var workout = {
      typ: toText(p.WFWorkoutActivityType || "Spacer"),
      "czas trwania": toNumber(p.WFWorkoutDuration) || 32,
      kcal: 248,
      start: new Date().toISOString()
    };
    device.workouts.push(workout);
    note("Zdrowie", "trening: " + workout.typ);
    return workout;
  });

  rule(/health/, "Zdrowie", function (p, ctx) {
    note("Zdrowie", "akcja Zdrowia wykonana na wirtualnym urządzeniu");
    return healthSample(toText(p.WFQuantitySampleType || ""));
  });

  /* Dom */
  rule(/home(kit)?\.?(scene|setscene)/, "Uruchom scenę", function (p, ctx) {
    var scene = toText(p.WFHomeSceneName || p.WFScene || input(p, ctx)) || device.scenes[0];
    note("Dom", "uruchomiono scenę „" + scene + "”");
    return scene;
  });

  rule(/home/, "Steruj urządzeniem w Domu", function (p, ctx) {
    var target = toText(p.WFHomeAccessoryName || p.WFAccessory || "") || Object.keys(device.home)[0];
    var state = toText(p.WFHomeAccessoryState || p.WFState || "");
    var accessory = device.home[target] || (device.home[target] = { typ: "urządzenie", stan: "wyłączone" });
    accessory.stan = state || (accessory.stan === "włączone" ? "wyłączone" : "włączone");
    note("Dom", target + " → " + accessory.stan);
    var out = {}; out[target] = accessory;
    return out;
  });

  /* Wiadomości, poczta, telefon */
  rule(/sendmessage|imessage/, "Wyślij wiadomość", function (p, ctx) {
    var message = {
      do: toText(p.WFSendMessageActionRecipients || p.WFRecipients || "Marta Kowalska"),
      treść: toText(p.WFSendMessageContent !== undefined ? p.WFSendMessageContent : input(p, ctx))
    };
    device.messages.push(message);
    note("Wiadomości", "do " + message.do + ": " + message.treść);
    return message;
  });

  rule(/sendemail|mail/, "Wyślij e-mail", function (p, ctx) {
    var mail = {
      do: toText(p.WFSendEmailActionToRecipients || "adres@example.com"),
      temat: toText(p.WFSendEmailActionSubject || "Wiadomość ze skrótu"),
      treść: toText(p.WFSendEmailActionInputAttachments !== undefined ? p.WFSendEmailActionInputAttachments : input(p, ctx))
    };
    device.mails.push(mail);
    note("Poczta", "do " + mail.do + " (" + mail.temat + ")");
    return mail;
  });

  rule(/call|facetime|phone/, "Połączenie", function (p, ctx) {
    var who = toText(p.WFCallContact || input(p, ctx)) || "Marta Kowalska";
    note("Telefon", "połączenie z " + who);
    return who;
  });

  /* Kalendarz, przypomnienia, notatki */
  rule(/addnewevent|calendar|event/, "Dodaj wydarzenie", function (p, ctx) {
    var event = {
      tytuł: toText(p.WFCalendarItemTitle || input(p, ctx)) || "Nowe wydarzenie",
      początek: toText(p.WFCalendarItemStartDate) || new Date().toISOString(),
      kalendarz: toText(p.WFCalendarItemCalendar) || "Praca"
    };
    device.events.push(event);
    note("Kalendarz", event.tytuł);
    return event;
  });

  rule(/reminder/, "Dodaj przypomnienie", function (p, ctx) {
    var reminder = {
      tytuł: toText(p.WFCalendarItemTitle || input(p, ctx)) || "Nowe przypomnienie",
      lista: toText(p.WFCalendarItemCalendar) || "Przypomnienia",
      termin: toText(p.WFCalendarItemStartDate) || ""
    };
    device.reminders.push(reminder);
    note("Przypomnienia", reminder.tytuł);
    return reminder;
  });

  rule(/note/, "Notatka", function (p, ctx) {
    var text = toText(p.WFNoteBody !== undefined ? p.WFNoteBody : input(p, ctx));
    device.notes.push({ treść: text, data: new Date().toISOString() });
    note("Notatki", text.slice(0, 60));
    return text;
  });

  /* Zdjęcia, aparat, pliki */
  rule(/takephoto|camera/, "Zrób zdjęcie", function () {
    var photo = { nazwa: "IMG_" + (4824 + device.photos.length) + ".HEIC", data: new Date().toISOString().slice(0, 10), album: "Ostatnie" };
    device.photos.push(photo);
    note("Aparat", "zrobiono zdjęcie " + photo.nazwa);
    return photo;
  });

  rule(/photo|image|album|screenshot/, "Zdjęcia", function (p, ctx) {
    var count = Math.max(1, Math.min(device.photos.length, toNumber(p.WFGetLatestPhotoCount) || 1));
    var picked = device.photos.slice(-count);
    note("Zdjęcia", "pobrano " + picked.length + " zdjęć");
    return picked.length === 1 ? picked[0] : picked;
  });

  rule(/savefile|documentpicker\.save|appendfile/, "Zapisz plik", function (p, ctx) {
    var path = toText(p.WFFileDestinationPath || p.WFGetFilePath || "Skróty/plik.txt");
    var content = toText(input(p, ctx));
    device.files[path] = content;
    note("Pliki", "zapisano " + path + " (" + content.length + " znaków)");
    return { ścieżka: path, rozmiar: content.length };
  });

  rule(/getfile|documentpicker|file|icloud/, "Pobierz plik", function (p, ctx) {
    var path = toText(p.WFGetFilePath || p.WFFileDestinationPath || Object.keys(device.files)[0]);
    var content = device.files[path];
    note("Pliki", "odczytano " + path);
    return content === undefined ? "" : content;
  });

  /* Media i ustawienia */
  rule(/playmusic|playpause|music|playsound|nexttrack|previoustrack/, "Odtwarzanie", function (p, ctx) {
    device.media.odtwarzanie = !device.media.odtwarzanie;
    device.media.utwór = toText(p.WFMediaItem || input(p, ctx)) || "Playlista „Poranek”";
    note("Muzyka", (device.media.odtwarzanie ? "odtwarzanie: " : "pauza: ") + device.media.utwór);
    return device.media;
  });

  rule(/setvolume|volume/, "Głośność", function (p, ctx) {
    device.settings["głośność"] = Math.max(0, Math.min(1, toNumber(p.WFVolume !== undefined ? p.WFVolume : input(p, ctx))));
    note("Ustawienia", "głośność " + Math.round(device.settings["głośność"] * 100) + "%");
    return device.settings["głośność"];
  });

  rule(/setbrightness|brightness/, "Jasność", function (p, ctx) {
    device.settings["jasność"] = Math.max(0, Math.min(1, toNumber(p.WFBrightness !== undefined ? p.WFBrightness : input(p, ctx))));
    note("Ustawienia", "jasność " + Math.round(device.settings["jasność"] * 100) + "%");
    return device.settings["jasność"];
  });

  var TOGGLES = [
    [/wifi/, "Wi-Fi"], [/bluetooth/, "Bluetooth"], [/airplane/, "Tryb samolotowy"],
    [/dnd|donotdisturb|focus/, "Nie przeszkadzać"], [/lowpower/, "Tryb niskiego zużycia energii"],
    [/flashlight|torch/, "Latarka"]
  ];

  rule(/wifi|bluetooth|airplane|dnd|donotdisturb|focus|lowpower|flashlight|torch|cellular|mobiledata/, "Przełącz ustawienie", function (p, ctx, id) {
    var name = "Ustawienie";
    for (var i = 0; i < TOGGLES.length; i++) {
      if (TOGGLES[i][0].test(id)) { name = TOGGLES[i][1]; break; }
    }
    var desired = p.OnValue !== undefined ? !!p.OnValue
      : p.WFState !== undefined ? /on|1|true|włącz/i.test(toText(p.WFState))
      : !device.settings[name];
    device.settings[name] = desired;
    note("Ustawienia", name + " → " + (desired ? "włączone" : "wyłączone"));
    return desired;
  });

  rule(/appearance|darkmode/, "Wygląd systemu", function (p) {
    device.settings["Wygląd"] = device.settings["Wygląd"] === "ciemny" ? "jasny" : "ciemny";
    note("Ustawienia", "wygląd: " + device.settings["Wygląd"]);
    return device.settings["Wygląd"];
  });

  /* Pogoda, mapy, kontakty, tłumaczenie */
  rule(/weather/, "Pogoda", function (p) {
    var detail = toText(p.WFWeatherCustomLocation || p.WFWeatherDetail || "");
    note("Pogoda", "odczyt dla " + (detail || WEATHER.lokalizacja));
    if (detail && WEATHER[detail] !== undefined) return WEATHER[detail];
    return WEATHER;
  });

  rule(/directions|maps|location|address/, "Mapy", function (p, ctx) {
    var target = toText(p.WFInput !== undefined ? p.WFInput : input(p, ctx)) || "Rynek Główny, Kraków";
    note("Mapy", "trasa do " + target);
    return { cel: target, dystans: "4,2 km", czas: "12 min", tryb: "samochód" };
  });

  rule(/contact/, "Kontakty", function (p, ctx) {
    note("Kontakty", "odczytano " + device.contacts.length + " kontaktów");
    return device.contacts;
  });

  rule(/translate/, "Tłumaczenie", function (p, ctx) {
    var text = toText(input(p, ctx));
    note("Tłumaczenie", text.slice(0, 40));
    return "[tłumaczenie] " + text;
  });

  rule(/ocr|recognizetext|qr|barcode|scan/, "Rozpoznaj tekst", function (p, ctx) {
    note("Wizja", "rozpoznano tekst na obrazie");
    return "Rozpoznany tekst z obrazu (emulacja)";
  });

  /* System i aplikacje */
  rule(/openapp|launchapp|app\./, "Otwórz aplikację", function (p, ctx) {
    var app = toText(p.WFAppIdentifier || p.WFApp || input(p, ctx)) || "Skróty";
    device.apps.push(app);
    note("System", "otwarto aplikację " + app);
    return app;
  });

  rule(/runworkflow|runshortcut/, "Uruchom inny skrót", function (p, ctx) {
    var name = toText(p.WFWorkflowName || input(p, ctx)) || "Podskrót";
    note("System", "wywołano skrót „" + name + "” (emulacja, nie wykonano jego akcji)");
    return input(p, ctx);
  });

  rule(/runsshscript|runscriptoverssh|shell|terminal/, "Skrypt powłoki", function (p, ctx) {
    var script = toText(p.WFShellScript || p.Script || input(p, ctx));
    note("System", "skrypt nie został wykonany: " + script.slice(0, 60));
    return "";
  });

  rule(/battery/, "Bateria", function () {
    note("System", "poziom baterii " + device.battery + "%");
    return device.battery;
  });

  rule(/timer|alarm|clock/, "Zegar", function (p, ctx) {
    var minutes = toNumber(p.WFTimerDuration) || 10;
    note("Zegar", "ustawiono na " + minutes + " min");
    return minutes;
  });

  /* ---------- rozstrzyganie ---------- */

  function resolve(id) {
    var name = String(id).replace(/^is\.workflow\.actions\./, "").toLowerCase();
    for (var i = 0; i < RULES.length; i++) {
      if (RULES[i].match.test(name)) return wrap(RULES[i], id);
    }
    return wrap(GENERIC, id);
  }

  /* Ostatnia deska ratunku: akcja nieznana silnikowi i regułom.
     Odczyt zwraca opisową wartość, zapis lub przełączenie przepuszcza wejście. */
  var GENERIC = {
    label: "Akcja systemowa",
    run: function (p, ctx, id) {
      var name = String(id).replace(/^is\.workflow\.actions\./, "");
      if (/^(get|detect|find|fetch|read)/.test(name)) {
        note("System", "odczyt z „" + name + "” zwrócił dane zastępcze");
        return { akcja: name, emulacja: true, wartość: "dane zastępcze" };
      }
      note("System", "akcja „" + name + "” wykonana na wirtualnym urządzeniu");
      return input(p, ctx);
    }
  };

  function wrap(spec, id) {
    return {
      label: spec.label,
      emulated: true,
      run: function (params, ctx, node) {
        return spec.run(params, ctx, String(id).replace(/^is\.workflow\.actions\./, "").toLowerCase(), node);
      }
    };
  }

  root.emulation = {
    resolve: resolve,
    device: function () { return device; },
    reset: reset,
    rules: function () { return RULES.length; }
  };
})(typeof window !== "undefined" ? (window.ShortRun = window.ShortRun || {}) : module.exports);
