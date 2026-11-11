import "server-only";
import { createHash, randomUUID } from "crypto";
import { listItems, putFile } from "./storage";

// Счётчики в хранилище (общие для всех копий функции на Vercel, в отличие от памяти):
// каждое событие — пустой файл в папке текущего окна времени, число файлов = число событий
const bucketOf = (windowMs: number) => Math.floor(Date.now() / windowMs);

async function count(prefix: string, cap: number): Promise<number> {
  let n = 0, cursor: string | undefined;
  for (let page = 0; page < 5 && n <= cap; page++) {
    const r = await listItems(prefix, 1000, cursor);
    n += r.items.length;
    if (!r.cursor) break;
    cursor = r.cursor;
  }
  return n;
}

const prefixOf = (key: string, windowMs: number) => `usage/${createHash("sha256").update(key).digest("hex").slice(0, 24)}/${bucketOf(windowMs)}/`;
export const usageCount = (key: string, windowMs: number, cap = 1000) => count(prefixOf(key, windowMs), cap);
export const usageHit = (key: string, windowMs: number) => putFile(`${prefixOf(key, windowMs)}${Date.now()}-${randomUUID().slice(0, 6)}`, "", "text/plain");

// true — лимит превышен (событие не записывается)
export async function overQuota(key: string, max: number, windowMs: number): Promise<boolean> {
  if ((await usageCount(key, windowMs, max)) >= max) return true;
  await usageHit(key, windowMs);
  return false;
}

const envNum = (name: string, def: number) => {
  const n = Number(process.env[name]);
  return Number.isFinite(n) && n >= 0 ? n : def;
};
export const LIMITS = {
  chatPerDay: () => envNum("USER_CHAT_DAILY", 150),
  soulPerDay: () => envNum("USER_SOUL_DAILY", 2),
  soulTotal: () => envNum("USER_SOUL_TOTAL", 10),
  uploadsPerDay: () => envNum("USER_UPLOADS_DAILY", 300),
  precheckPerHour: () => envNum("USER_PRECHECK_HOURLY", 40),
};

export const quotaError = (message: string) => Object.assign(new Error(message), { status: 429 });
