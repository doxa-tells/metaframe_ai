import "server-only";
import { describeNetError, isNetworkError, withRetry } from "./net";
import { promises as fs } from "fs";
import path from "path";
import { createHmac, randomUUID } from "crypto";
import { put, list, del } from "@vercel/blob";
import { BASE } from "./base";

// Ссылки на локальные файлы (режим разработки): /studio/api/files/<ключ>; старые — без /studio
export const LOCAL_PREFIX = `${BASE}/api/files/`;
export function localKeyOf(url: string): string | null {
  if (url.startsWith(LOCAL_PREFIX)) return url.slice(LOCAL_PREFIX.length);
  if (url.startsWith("/api/files/")) return url.slice("/api/files/".length);
  return null;
}

// Хранилище: Cloudflare R2 через воркер (основной вариант), Vercel Blob (запасной)
// или локальная папка .data для разработки.
// Все записи неизменяемые (новый файл вместо перезаписи): файлы отдаются с долгим кешем.

const WORKER_URL = (process.env.STORAGE_URL || "").trim().replace(/\/$/, "");
const WORKER_SECRET = (process.env.STORAGE_SECRET || "").trim();
export const useWorker = Boolean(WORKER_URL && WORKER_SECRET);
export const useBlob = !useWorker && Boolean(process.env.BLOB_READ_WRITE_TOKEN);
export const storageMode: "worker" | "blob" | "local" = useWorker ? "worker" : useBlob ? "blob" : "local";

const encKey = (key: string) => key.split("/").map(encodeURIComponent).join("/");
const workerUrl = (key: string) => `${WORKER_URL}/f/${encKey(key)}`;
const auth = () => ({ Authorization: `Bearer ${WORKER_SECRET}` });

async function workerFetch(input: string, init: RequestInit = {}): Promise<Response> {
  // Поток можно отправить только один раз — его не повторяем
  const canRetry = !(init.body && typeof init.body === "object" && "getReader" in (init.body as object));
  let res: Response;
  try {
    res = await withRetry(async () => {
      const r = await fetch(input, { ...init, cache: "no-store", headers: { ...auth(), ...(init.headers ?? {}) } });
      if (r.status >= 500 && canRetry) throw Object.assign(new Error(`R2 ${r.status}`), { retryable: true, res: r });
      return r;
    }, { tries: canRetry ? 3 : 1, retryIf: (e) => isNetworkError(e) || Boolean((e as { retryable?: boolean }).retryable) });
  } catch (e) {
    const r5 = (e as { res?: Response }).res;
    if (!r5) throw describeNetError(e, "хранилищем R2");
    res = r5;
  }
  if (!res.ok) {
    const text = (await res.text()).trim();
    const detail = text.startsWith("<") ? "" : ` ${text.slice(0, 160)}`;
    throw Object.assign(new Error(`Хранилище R2 не ответило (${res.status})${detail}`), { status: 502 });
  }
  return res;
}

// Подписанная ссылка для загрузки файла прямо из браузера в R2 (действует 15 минут)
export function signUpload(fileName: string): { uploadUrl: string; url: string } {
  const safe = fileName.replace(/[^a-zA-Z0-9._-]/g, "_").slice(-60) || "file";
  const key = `uploads/${randomUUID().slice(0, 12)}-${safe}`;
  const exp = Math.floor(Date.now() / 1000) + 15 * 60;
  const sig = createHmac("sha256", WORKER_SECRET).update(`${key}:${exp}`).digest("hex");
  return { uploadUrl: `${workerUrl(key)}?exp=${exp}&sig=${sig}`, url: workerUrl(key) };
}
const LOCAL_DIR = path.join(process.cwd(), ".data");

export type StoredItem = { pathname: string; url: string };

type Body = Buffer | string | ReadableStream<Uint8Array>;

// На Vercel файловая система только для чтения: без Blob сохранять некуда
export const storageMissing = storageMode === "local" && Boolean(process.env.VERCEL);
const STORAGE_ERROR = "Хранилище не подключено: добавьте STORAGE_URL и STORAGE_SECRET в Vercel → Settings → Environment Variables и сделайте Redeploy";

export async function putFile(pathname: string, body: Body, contentType: string): Promise<string> {
  if (storageMissing) throw Object.assign(new Error(STORAGE_ERROR), { status: 503 });
  if (useWorker) {
    const isStream = typeof body !== "string" && !Buffer.isBuffer(body);
    await workerFetch(workerUrl(pathname), {
      method: "PUT",
      headers: { "Content-Type": contentType },
      body: (isStream ? body : typeof body === "string" ? body : new Uint8Array(body)) as BodyInit,
      ...(isStream ? { duplex: "half" } : {}),
    } as RequestInit);
    return workerUrl(pathname);
  }
  if (useBlob) {
    const res = await put(pathname, body as never, {
      access: "public",
      contentType,
      addRandomSuffix: false,
      allowOverwrite: true,
      multipart: typeof body !== "string" && !Buffer.isBuffer(body),
    });
    return res.url;
  }
  const full = path.join(LOCAL_DIR, pathname);
  await fs.mkdir(path.dirname(full), { recursive: true });
  if (typeof body === "string" || Buffer.isBuffer(body)) {
    await fs.writeFile(full, body);
  } else {
    const chunks: Uint8Array[] = [];
    const reader = body.getReader();
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(value);
    }
    await fs.writeFile(full, Buffer.concat(chunks));
  }
  return `${LOCAL_PREFIX}${pathname}`;
}

export async function putJSON(pathname: string, data: unknown): Promise<string> {
  return putFile(pathname, JSON.stringify(data), "application/json");
}

export async function listItems(prefix: string, limit = 50, cursor?: string): Promise<{ items: StoredItem[]; cursor?: string }> {
  if (storageMissing) return { items: [] };
  if (useWorker) {
    const q = new URLSearchParams({ prefix, limit: String(limit) });
    if (cursor) q.set("cursor", cursor);
    const d = (await (await workerFetch(`${WORKER_URL}/list?${q}`)).json()) as { items: { key: string }[]; cursor: string | null };
    return { items: d.items.map((i) => ({ pathname: i.key, url: workerUrl(i.key) })), cursor: d.cursor ?? undefined };
  }
  if (useBlob) {
    const res = await list({ prefix, limit, cursor });
    return {
      items: res.blobs.map((b) => ({ pathname: b.pathname, url: b.url })),
      cursor: res.hasMore ? res.cursor : undefined,
    };
  }
  // Как в Blob: префикс — это начало пути, не обязательно папка
  const dir = path.join(LOCAL_DIR, prefix.endsWith("/") ? prefix : path.posix.dirname(prefix));
  const all: string[] = [];
  async function walk(d: string) {
    let entries: import("fs").Dirent[] = [];
    try { entries = await fs.readdir(d, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) await walk(p);
      else all.push(path.relative(LOCAL_DIR, p).split(path.sep).join("/"));
    }
  }
  await walk(dir);
  const filtered = all.filter((p) => p.startsWith(prefix));
  all.length = 0;
  all.push(...filtered);
  all.sort();
  const start = cursor ? Number(cursor) : 0;
  const slice = all.slice(start, start + limit);
  return {
    items: slice.map((p) => ({ pathname: p, url: `${LOCAL_PREFIX}${p}` })),
    cursor: start + limit < all.length ? String(start + limit) : undefined,
  };
}

export async function readJSON<T>(item: StoredItem | string): Promise<T | null> {
  const url = typeof item === "string" ? item : item.url;
  const lk = localKeyOf(url);
  if (storageMode === "local" && lk) {
    try {
      const txt = await fs.readFile(path.join(LOCAL_DIR, lk), "utf8");
      return JSON.parse(txt) as T;
    } catch { return null; }
  }
  try {
    const r = await fetch(url, { cache: "no-store" });
    if (!r.ok) return null;
    return (await r.json()) as T;
  } catch { return null; }
}

export async function deleteItems(items: StoredItem[]): Promise<void> {
  if (!items.length) return;
  if (useWorker) {
    await Promise.all(items.map((i) => workerFetch(workerUrl(i.pathname), { method: "DELETE" })));
    return;
  }
  if (useBlob) {
    await del(items.map((i) => i.url));
    return;
  }
  await Promise.all(items.map((i) => fs.rm(path.join(LOCAL_DIR, i.pathname), { force: true })));
}

export async function readLocalFile(pathname: string): Promise<Buffer | null> {
  const full = path.join(LOCAL_DIR, pathname);
  if (!full.startsWith(LOCAL_DIR)) return null;
  try { return await fs.readFile(full); } catch { return null; }
}

// Абсолютный URL для провайдеров (локальные файлы им недоступны)
export function toAbsolute(url: string, origin: string): string {
  if (/^https?:\/\//.test(url)) return url;
  return new URL(url, origin).toString();
}
