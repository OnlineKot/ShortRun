# Własne proxy CORS dla ShortRun

iCloud nie wysyła nagłówka `Access-Control-Allow-Origin`, więc przeglądarka nie pobierze
rekordu skrótu wprost ze strony w innej domenie. ShortRun próbuje wtedy publicznych proxy,
ale te bywają zawodne. Sprawdzone 22 września 2026 z sieci centrum danych:

| Proxy | Wynik |
| --- | --- |
| `api.allorigins.win` | HTTP 522, host nie odpowiada |
| `api.codetabs.com` | HTTP 522, host nie odpowiada |
| `cors.isomorphic-git.org` | zablokowane przez WAF |
| `corsproxy.io` | wymaga klucza API |
| `api.cors.lol` | przekroczony limit zapytań |
| `proxy.corsfix.com` | działa tylko z nagłówkiem `Origin`, czyli z `fetch()` w przeglądarce |

Dlatego najpewniejsza droga to własny worker. Plan darmowy Cloudflare w zupełności wystarcza.

## Wdrożenie

1. Wejdź na [dash.cloudflare.com](https://dash.cloudflare.com) → **Workers & Pages** → **Create** → **Worker**.
2. Wklej zawartość [`worker.js`](worker.js) jako kod workera i kliknij **Deploy**.
3. Skopiuj adres workera, na przykład `https://shortrun-proxy.twoj-login.workers.dev`.
4. W ShortRun otwórz **Ustawienia → Własne proxy** i wpisz:
   `https://shortrun-proxy.twoj-login.workers.dev/?url={url}`

Od tej chwili ShortRun używa Twojego proxy przed publicznymi. Przycisk **Diagnostyka**
pokaże, która droga odpowiada.

## Co worker przepuszcza

Tylko `https` i tylko hosty potrzebne do wczytania skrótu: `www.icloud.com`, `icloud.com`
oraz `cvws.icloud-content.com`, po których iCloud serwuje plik skrótu. Metody inne niż
GET, HEAD i OPTIONS są odrzucane. Dzięki temu adres workera nie staje się otwartym proxy.

## Jeszcze prościej

Jeśli publikujesz ShortRun na Cloudflare Pages, dodaj tego workera jako funkcję w tym samym
projekcie. Strona i proxy są wtedy w jednej domenie, więc problem CORS znika całkowicie.
