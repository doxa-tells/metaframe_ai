import "server-only";
import { createHash, randomBytes, randomUUID, scrypt as scryptCb, timingSafeEqual } from "crypto";
import { promisify } from "util";
import { listItems, putPrivateJSON as putJSON, readPrivateJSON as readJSON } from "./storage";

const scrypt = promisify(scryptCb) as (pw: string, salt: Buffer, len: number) => Promise<Buffer>;

// Пользователи студии. Регистрация → «на проверке» → владелец подтверждает личность вручную.
// Нарушения: предупреждение, заморозка (на срок или бессрочно), бан. Всё пишется в журнал (lib/modlog).
export type UserStatus = "pending" | "active" | "frozen" | "banned" | "rejected";
export type UserWarning = { id: string; at: number; reason: string; jobId?: string; ack?: number };

export type UserRecord = {
  id: string;
  email: string;
  name: string;          // ФИО, как в документе
  phone: string;
  country: string;
  purpose: string;       // для чего нужна студия
  passHash: string;
  status: UserStatus;
  statusReason?: string;
  frozenUntil?: number;  // заморозка на срок; без даты — пока не снимут
  ver: number;           // меняется при бане/смене пароля — старые сессии перестают работать
  createdAt: number;
  createdIp?: string;
  lastLoginAt?: number;
  lastIp?: string;
  verifiedAt?: number;
  verifyNote?: string;   // как подтверждена личность (созвон, документ и т.п.)
  consent: { version: string; at: number; ip?: string };
  warnings: UserWarning[];
  blocked: number[];     // время срабатываний модерации провайдеров (последние 50)
  blockedTotal: number;
  dailyLimit?: number;   // $ в сутки; без значения — USER_DAILY_LIMIT
  souls?: string[];      // свои Soul ID (Higgsfield)
  credits?: number;      // баланс кредитов
  payClaim?: { pkg: string; credits: number; price: number; at: number }; // «оплатил, жду начисления»
  note?: string;         // заметка владельца
};

export type PublicUser = Omit<UserRecord, "passHash">;
export { CONSENT_VERSION } from "./consent";

const userPath = (id: string) => `users/${id}.json`;
const emailPath = (email: string) => `users-email/${createHash("sha256").update(normEmail(email)).digest("hex").slice(0, 40)}.json`;
export const normEmail = (e: string) => e.trim().toLowerCase();
export const validUid = (id: unknown): id is string => typeof id === "string" && /^u[a-f0-9]{10}$/.test(id);
export const newUid = () => `u${randomUUID().replace(/-/g, "").slice(0, 10)}`;
export const defaultDailyLimit = () => {
  const n = Number(process.env.USER_DAILY_LIMIT);
  return Number.isFinite(n) && n > 0 ? n : 50;
};

export async function hashPassword(pw: string): Promise<string> {
  const salt = randomBytes(16);
  const h = await scrypt(pw, salt, 64);
  return `s1$${salt.toString("hex")}$${h.toString("hex")}`;
}
export async function checkPassword(pw: string, stored: string): Promise<boolean> {
  const [v, saltHex, hashHex] = stored.split("$");
  if (v !== "s1" || !saltHex || !hashHex) return false;
  const h = await scrypt(pw, Buffer.from(saltHex, "hex"), 64);
  const want = Buffer.from(hashHex, "hex");
  return want.length === h.length && timingSafeEqual(h, want);
}

// Кэш на несколько секунд: статус проверяется на каждом запросе к API
const cache = new Map<string, { at: number; rec: UserRecord | null }>();
const TTL = 8_000;

async function readAt<T>(p: string): Promise<T | null> {
  const { items } = await listItems(p, 1);
  const it = items.find((i) => i.pathname === p);
  return it ? readJSON<T>(it) : null;
}

export async function getUser(id: string, fresh = false): Promise<UserRecord | null> {
  if (!validUid(id)) return null;
  const hit = cache.get(id);
  if (!fresh && hit && Date.now() - hit.at < TTL) return hit.rec;
  const rec = await readAt<UserRecord>(userPath(id));
  if (rec) { rec.warnings ??= []; rec.blocked ??= []; rec.blockedTotal ??= 0; rec.ver ??= 1; }
  cache.set(id, { at: Date.now(), rec });
  return rec;
}

export async function findByEmail(email: string): Promise<UserRecord | null> {
  const idx = await readAt<{ id: string }>(emailPath(email));
  return idx?.id ? getUser(idx.id, true) : null;
}

// Записи одного пользователя идут по очереди, чтобы параллельные правки не затирали друг друга
const chains = new Map<string, Promise<unknown>>();
export function updateUser(id: string, fn: (u: UserRecord) => UserRecord | void): Promise<UserRecord> {
  const prev = chains.get(id) ?? Promise.resolve();
  const run = prev.then(async () => {
    const cur = await getUser(id, true);
    if (!cur) throw Object.assign(new Error("Пользователь не найден"), { status: 404 });
    const next = fn(cur) ?? cur;
    await putJSON(userPath(id), next);
    cache.set(id, { at: Date.now(), rec: next });
    usersCache = null;
    return next;
  });
  chains.set(id, run.catch(() => {}));
  return run;
}

export async function createUser(input: Omit<UserRecord, "id" | "passHash" | "status" | "ver" | "createdAt" | "warnings" | "blocked" | "blockedTotal"> & { password: string }): Promise<UserRecord> {
  const { password, ...rest } = input;
  const rec: UserRecord = {
    ...rest,
    email: normEmail(rest.email),
    id: newUid(),
    passHash: await hashPassword(password),
    status: "pending",
    ver: 1,
    createdAt: Date.now(),
    warnings: [],
    blocked: [],
    blockedTotal: 0,
  };
  await putJSON(userPath(rec.id), rec);
  await putJSON(emailPath(rec.email), { id: rec.id });
  cache.set(rec.id, { at: Date.now(), rec });
  usersCache = null;
  return rec;
}

let usersCache: { at: number; list: UserRecord[] } | null = null;
export async function listUsers(fresh = false): Promise<UserRecord[]> {
  if (!fresh && usersCache && Date.now() - usersCache.at < 15_000) return usersCache.list;
  const all: UserRecord[] = [];
  let cursor: string | undefined;
  for (let page = 0; page < 20; page++) {
    const r = await listItems("users/", 200, cursor);
    const recs = await Promise.all(r.items.filter((i) => /^users\/u[a-f0-9]{10}\.json$/.test(i.pathname)).map((i) => readJSON<UserRecord>(i)));
    for (const u of recs) if (u) { u.warnings ??= []; u.blocked ??= []; u.blockedTotal ??= 0; all.push(u); }
    if (!r.cursor) break;
    cursor = r.cursor;
  }
  all.sort((a, b) => b.createdAt - a.createdAt);
  usersCache = { at: Date.now(), list: all };
  return all;
}

// Заморозка на срок снимается сама, когда срок прошёл
export function effectiveStatus(u: UserRecord): UserStatus {
  if (u.status === "frozen" && u.frozenUntil && u.frozenUntil < Date.now()) return "active";
  return u.status;
}

export function publicUser(u: UserRecord): PublicUser {
  const { passHash: _p, ...rest } = u;
  return { ...rest, status: effectiveStatus(u) };
}
