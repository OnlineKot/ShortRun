/* Wczytywanie definicji skrótu: link iCloud, plik .shortcut/.plist/.json, wklejony tekst. */
(function (root) {
  "use strict";

  var ICLOUD_API = "https://www.icloud.com/shortcuts/api/records/";

  /* iCloud nie wysyła nagłówków CORS, więc bezpośrednie pobranie z obcej domeny
     kończy się błędem sieci. Dlatego po nieudanej próbie wprost idziemy przez
     publiczne proxy. {url} to adres zakodowany, {raw} adres dosłowny. */
  /* Lista sprawdzona prawdziwym ruchem 22.09.2026. Odpadły: corsproxy.io (wymaga
     klucza API), cors.isomorphic-git.org (blokada WAF), api.cors.lol (limit zapytań).
     Zostały te, które odpowiadają, ale i one bywają wyłączone, więc pewną drogą
     jest własny worker z katalogu proxy/. */
  var PUBLIC_PROXIES = [
    { name: "allorigins", template: "https://api.allorigins.win/raw?url={url}" },
    { name: "codetabs", template: "https://api.codetabs.com/v1/proxy/?quest={url}" },
    { name: "corsfix", template: "https://proxy.corsfix.com/?{raw}" }
  ];

  /* Proxy potrafi odpowiedzieć kodem 200 i własnym błędem w treści.
     Takie odpowiedzi traktujemy jak porażkę trasy, nie jak plik skrótu. */
  var PROXY_ERRORS = [
    { marker: /valid API key is required/i, reason: "wymaga klucza API" },
    { marker: /corsfix_error|invalid_origin/i, reason: "odrzucone przez corsfix" },
    { marker: /Rate limit exceeded/i, reason: "przekroczony limit zapytań" },
    { marker: /Connection timed out|error code:? ?52\d/i, reason: "serwer proxy nie odpowiada" },
    { marker: /you have been blocked|Attention Required/i, reason: "zablokowane przez zabezpieczenia proxy" },
    { marker: /Just a moment\.\.\./i, reason: "proxy żąda przejścia testu Cloudflare" }
  ];

  /* Ani rekord, ani plik skrótu nie są HTML-em. Strona HTML w odpowiedzi zawsze
     oznacza pomyłkę: brak endpointu, przekierowanie hostingu albo komunikat proxy. */
  function looksLikeHtml(head) {
    return /^\s*(<!doctype html|<html[\s>])/i.test(head);
  }

  function proxyErrorIn(buf) {
    var head = new TextDecoder("utf-8", { fatal: false }).decode(new Uint8Array(buf, 0, Math.min(1200, buf.byteLength)));
    for (var i = 0; i < PROXY_ERRORS.length; i++) {
      if (PROXY_ERRORS[i].marker.test(head)) return PROXY_ERRORS[i].reason;
    }
    if (looksLikeHtml(head)) return "odpowiedź to strona HTML, nie dane skrótu";
    return null;
  }

  function idFromLink(link) {
    var text = String(link || "").trim();
    var m = /icloud\.com\/shortcuts\/(?:api\/records\/)?([0-9a-fA-F]{20,40})/.exec(text);
    if (m) return m[1];
    if (/^[0-9a-fA-F]{20,40}$/.test(text)) return text;
    return null;
  }

  /* Gdy strona stoi na Cloudflare Pages, funkcja z functions/proxy.js daje jej
     własne proxy na tej samej domenie. Na innym hostingu trasa zwróci 404
     i łańcuch po prostu idzie dalej. */
  function sameOriginProxy(url) {
    if (typeof location === "undefined" || !/^https?:$/.test(location.protocol)) return null;
    return location.origin + "/proxy?url=" + encodeURIComponent(url);
  }

  function applyTemplate(template, url) {
    if (template.indexOf("{url}") !== -1) return template.replace("{url}", encodeURIComponent(url));
    if (template.indexOf("{raw}") !== -1) return template.replace("{raw}", url.replace(/^https?:\/\//, ""));
    return template + encodeURIComponent(url);
  }

  /* Kolejność prób: wprost, proxy użytkownika, potem publiczne.
     Trasa, która zadziałała wcześniej w tym samym wczytywaniu, idzie na początek. */
  function routesFor(url, options) {
    var routes = [{ name: "bezpośrednio", url: url }];
    var own = sameOriginProxy(url);
    if (own) routes.push({ name: "proxy tej strony", url: own });
    if (options.proxy) routes.push({ name: "własne proxy", url: applyTemplate(options.proxy, url) });
    if (options.publicProxies !== false) {
      PUBLIC_PROXIES.forEach(function (proxy) {
        routes.push({ name: proxy.name, url: applyTemplate(proxy.template, url) });
      });
    }
    if (!options.prefer) return routes;
    var preferred = routes.filter(function (route) { return route.name === options.prefer; });
    return preferred.concat(routes.filter(function (route) { return route.name !== options.prefer; }));
  }

  function fetchBuffer(url, options) {
    options = options || {};
    var routes = routesFor(url, options);
    var failures = [];

    return routes.reduce(function (chain, route) {
      return chain.catch(function () {
        return fetch(route.url, { credentials: "omit" }).then(function (res) {
          if (!res.ok) throw new Error("HTTP " + res.status);
          return res.arrayBuffer();
        }).then(function (buf) {
          if (!buf || buf.byteLength === 0) throw new Error("pusta odpowiedź");
          var proxyError = proxyErrorIn(buf);
          if (proxyError) throw new Error(proxyError);
          if (options.onRoute) options.onRoute(route.name);
          return buf;
        }).catch(function (err) {
          failures.push(route.name + ": " + describeFailure(err));
          throw err;
        });
      });
    }, Promise.reject(new Error("start"))).catch(function () {
      var error = new Error("Nie udało się pobrać danych z " + hostOf(url) + ".\n" + failures.join("\n"));
      error.code = "FETCH";
      error.attempts = failures;
      throw error;
    });
  }

  function describeFailure(err) {
    var message = err && err.message ? err.message : String(err);
    if (/Failed to fetch|NetworkError|Load failed|CORS/i.test(message)) return "zablokowane przez CORS";
    return message;
  }

  function hostOf(url) {
    try { return new URL(url).hostname; } catch (e) { return url; }
  }

  function fetchJson(url, options) {
    return fetchBuffer(url, options).then(function (buf) {
      var text = new TextDecoder("utf-8").decode(new Uint8Array(buf));
      try {
        return JSON.parse(text);
      } catch (e) {
        throw new Error("Odpowiedź nie jest JSON-em (pierwsze znaki: " + text.slice(0, 40) + ").");
      }
    });
  }

  /* Sprawdza po kolei wszystkie trasy i zwraca raport, nie przerywając na pierwszym błędzie. */
  function diagnose(link, options) {
    options = options || {};
    var id = idFromLink(link);
    if (!id) return Promise.reject(new Error("Najpierw wklej poprawny link iCloud."));
    var url = ICLOUD_API + id;

    return root.val.mapSeries(routesFor(url, options), function (route) {
      var started = Date.now();
      return fetch(route.url, { credentials: "omit" }).then(function (res) {
        return res.text().then(function (text) {
          var ok = res.ok && text.indexOf("\"fields\"") !== -1;
          var known = null;
          for (var i = 0; i < PROXY_ERRORS.length && !known; i++) {
            if (PROXY_ERRORS[i].marker.test(text)) known = PROXY_ERRORS[i].reason;
          }
          if (!known && looksLikeHtml(text)) {
            known = route.name === "proxy tej strony"
              ? "ten hosting nie ma endpointu /proxy"
              : "odpowiedź to strona HTML, nie rekord";
          }
          return {
            name: route.name,
            ok: ok,
            detail: ok ? "rekord pobrany w " + (Date.now() - started) + " ms"
                       : (known || "HTTP " + res.status + ", " + text.slice(0, 60).replace(/\s+/g, " "))
          };
        });
      }, function (err) {
        return { name: route.name, ok: false, detail: describeFailure(err) };
      });
    });
  }

  function fromICloud(link, options) {
    options = options || {};
    var id = idFromLink(link);
    if (!id) {
      return Promise.reject(new Error("To nie wygląda na link iCloud do skrótu (oczekiwano icloud.com/shortcuts/…)."));
    }
    var meta = null;
    var routeUsed = null;
    var fetchOptions = {
      proxy: options.proxy || "",
      publicProxies: options.publicProxies !== false,
      onRoute: function (name) {
        if (!routeUsed) routeUsed = name;
        fetchOptions.prefer = name;
      }
    };

    return fetchJson(ICLOUD_API + id, fetchOptions).then(function (record) {
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
      return tryAssets(assets, fetchOptions);
    }).then(function (shortcut) {
      meta.route = routeUsed;
      shortcut.__meta = meta;
      return shortcut;
    });
  }

  // CloudKit zwraca adres z placeholderem ${f} w miejscu nazwy pliku.
  function assetUrl(asset) {
    var url = asset.downloadURL || asset.url;
    return url ? url.replace("${f}", "shortcut.plist") : null;
  }

  function tryAssets(urls, fetchOptions) {
    return urls.reduce(function (chain, url) {
      return chain.catch(function (previous) {
        return fetchBuffer(url, fetchOptions)
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
    diagnose: diagnose,
    proxies: PUBLIC_PROXIES,
    fromFile: fromFile,
    fromText: fromText,
    idFromLink: idFromLink,
    extract: extract
  };
})(typeof window !== "undefined" ? (window.ShortRun = window.ShortRun || {}) : module.exports);
