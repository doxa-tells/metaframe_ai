// Хранилище MetaFrame: воркер Cloudflare поверх бакета R2.
//   GET  /f/<key>                 — публичная раздача файла (с поддержкой Range для видео)
//   PUT  /f/<key>                 — запись (Bearer STORAGE_SECRET или подписанная ссылка ?exp=&sig=)
//   DELETE /f/<key>               — удаление (Bearer)
//   GET  /list?prefix=&cursor=&limit= — список ключей по алфавиту (Bearer)
//   GET  /health                  — проверка

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET,HEAD,PUT,DELETE,OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type,Authorization,Range",
  "Access-Control-Expose-Headers": "Content-Length,Content-Range,ETag",
  "Access-Control-Max-Age": "86400",
};

const json = (data, status = 200) =>
  new Response(JSON.stringify(data), { status, headers: { ...CORS, "Content-Type": "application/json" } });

async function hmacHex(secret, message) {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey("raw", enc.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = await crypto.subtle.sign("HMAC", key, enc.encode(message));
  return [...new Uint8Array(sig)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

function safeEqual(a, b) {
  if (a.length !== b.length) return false;
  let d = 0;
  for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return d === 0;
}

export default {
  async fetch(req, env) {
    const url = new URL(req.url);
    if (req.method === "OPTIONS") return new Response(null, { headers: CORS });
    if (!env.STORAGE_SECRET) return json({ error: "STORAGE_SECRET не задан" }, 500);
    const authed = safeEqual(req.headers.get("Authorization") || "", `Bearer ${env.STORAGE_SECRET}`);

    if (url.pathname === "/health") {
      await env.BUCKET.list({ limit: 1 });
      return json({ ok: true });
    }

    if (url.pathname === "/list") {
      if (!authed) return json({ error: "unauthorized" }, 401);
      const limit = Math.min(1000, Math.max(1, Number(url.searchParams.get("limit") || 100)));
      const res = await env.BUCKET.list({
        prefix: url.searchParams.get("prefix") || undefined,
        cursor: url.searchParams.get("cursor") || undefined,
        limit,
      });
      return json({ items: res.objects.map((o) => ({ key: o.key, size: o.size })), cursor: res.truncated ? res.cursor : null });
    }

    if (!url.pathname.startsWith("/f/")) return json({ error: "not found" }, 404);
    const key = url.pathname.slice(3).split("/").map(decodeURIComponent).join("/");
    if (!key || key.includes("..")) return json({ error: "bad key" }, 400);

    if (req.method === "GET" || req.method === "HEAD") {
      const obj = await env.BUCKET.get(key, { range: req.headers, onlyIf: req.headers });
      if (obj === null) return new Response("Not found", { status: 404, headers: CORS });
      const h = new Headers(CORS);
      obj.writeHttpMetadata(h);
      h.set("ETag", obj.httpEtag);
      h.set("Accept-Ranges", "bytes");
      h.set("Cache-Control", "public, max-age=31536000, immutable");
      if (!("body" in obj)) return new Response(null, { status: 304, headers: h });
      let status = 200;
      if (obj.range && req.headers.has("range")) {
        const r = obj.range;
        const start = r.suffix !== undefined ? obj.size - r.suffix : r.offset ?? 0;
        const end = r.length !== undefined ? start + r.length - 1 : obj.size - 1;
        h.set("Content-Range", `bytes ${start}-${end}/${obj.size}`);
        h.set("Content-Length", String(end - start + 1));
        status = 206;
      } else {
        h.set("Content-Length", String(obj.size));
      }
      return new Response(req.method === "HEAD" ? null : obj.body, { status, headers: h });
    }

    if (req.method === "PUT") {
      let allowed = authed;
      if (!allowed) {
        // Подписанная ссылка для загрузки из браузера: только в uploads/ и только до истечения срока
        const exp = Number(url.searchParams.get("exp") || 0);
        const sig = url.searchParams.get("sig") || "";
        if (key.startsWith("uploads/") && exp > Date.now() / 1000) {
          allowed = safeEqual(sig, await hmacHex(env.STORAGE_SECRET, `${key}:${exp}`));
        }
      }
      if (!allowed) return json({ error: "unauthorized" }, 401);
      const contentType = req.headers.get("Content-Type") || "application/octet-stream";
      // R2 принимает поток только известной длины; при chunked-передаче буферизуем
      const len = Number(req.headers.get("Content-Length") || 0);
      const body = len > 0 ? req.body : await req.arrayBuffer();
      await env.BUCKET.put(key, body, { httpMetadata: { contentType } });
      return json({ ok: true, key });
    }

    if (req.method === "DELETE") {
      if (!authed) return json({ error: "unauthorized" }, 401);
      await env.BUCKET.delete(key);
      return json({ ok: true });
    }

    return json({ error: "method not allowed" }, 405);
  },
};
