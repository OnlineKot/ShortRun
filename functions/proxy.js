/* Endpoint proxy dla ShortRun jako funkcja Cloudflare Pages.
   Gdy strona jest hostowana na Cloudflare Pages, ten plik daje jej własne
   proxy pod /proxy?url=… na tej samej domenie. ShortRun sprawdza tę trasę
   zaraz po próbie bezpośredniej, więc nie trzeba niczego konfigurować.

   Na innym hostingu (np. GitHub Pages) trasa po prostu zwróci 404,
   a ShortRun pójdzie dalej: własne proxy z Ustawień, potem publiczne.
   Samodzielny worker dla takiego przypadku leży w proxy/worker.js. */

const ALLOWED_HOSTS = ["www.icloud.com", "icloud.com", "cvws.icloud-content.com"];

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, HEAD, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type"
};

export async function onRequest({ request }) {
  if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS });
  if (request.method !== "GET" && request.method !== "HEAD") {
    return json({ error: "Dozwolone są tylko GET i HEAD." }, 405);
  }

  const target = new URL(request.url).searchParams.get("url");
  if (!target) return json({ error: "Brak parametru url." }, 400);

  let parsed;
  try {
    parsed = new URL(target);
  } catch {
    return json({ error: "Parametr url nie jest poprawnym adresem." }, 400);
  }
  if (parsed.protocol !== "https:" || !ALLOWED_HOSTS.includes(parsed.hostname)) {
    return json({ error: "Host spoza listy dozwolonych: " + parsed.hostname }, 403);
  }

  const upstream = await fetch(parsed.toString(), {
    method: request.method,
    headers: { "User-Agent": "ShortRun-Proxy" },
    redirect: "follow"
  });

  const headers = new Headers(CORS);
  const type = upstream.headers.get("content-type");
  if (type) headers.set("Content-Type", type);
  headers.set("Cache-Control", "public, max-age=300");
  return new Response(upstream.body, { status: upstream.status, headers });
}

function json(body, status) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, "Content-Type": "application/json" }
  });
}
