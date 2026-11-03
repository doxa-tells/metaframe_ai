import "server-only";
import { promises as fs } from "fs";
import path from "path";
import { put, list, del } from "@vercel/blob";

// Хранилище: Vercel Blob в продакшене, локальная папка .data для разработки.
// Все записи неизменяемые (новый файл вместо перезаписи), потому что публичные
// файлы Blob кешируются CDN и перезапись читалась бы со старым содержимым.

export const useBlob = Boolean(process.env.BLOB_READ_WRITE_TOKEN);
const LOCAL_DIR = path.join(process.cwd(), ".data");

export type StoredItem = { pathname: string; url: string };

type Body = Buffer | string | ReadableStream<Uint8Array>;

export async function putFile(pathname: string, body: Body, contentType: string): Promise<string> {
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
  return `/api/files/${pathname}`;
}

export async function putJSON(pathname: string, data: unknown): Promise<string> {
  return putFile(pathname, JSON.stringify(data), "application/json");
}

export async function listItems(prefix: string, limit = 50, cursor?: string): Promise<{ items: StoredItem[]; cursor?: string }> {
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
    items: slice.map((p) => ({ pathname: p, url: `/api/files/${p}` })),
    cursor: start + limit < all.length ? String(start + limit) : undefined,
  };
}

export async function readJSON<T>(item: StoredItem | string): Promise<T | null> {
  const url = typeof item === "string" ? item : item.url;
  if (!useBlob && url.startsWith("/api/files/")) {
    try {
      const txt = await fs.readFile(path.join(LOCAL_DIR, url.slice("/api/files/".length)), "utf8");
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
