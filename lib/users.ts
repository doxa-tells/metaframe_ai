import "server-only";
import { createHash, randomBytes, randomUUID, scrypt as scryptCb, timingSafeEqual } from "crypto";
import { promisify } from "util";
import { listItems, putPrivateJSON as putJSON, putPrivateJSONIf, readPrivateAt, readPrivateJSON as readJSON } from "./storage";
import type { PlanId } from "./plans";
import { logAction } from "./modlog";

const scrypt = promisify(scryptCb) as (pw: string, salt: Buffer, len: number) => Promise<Buffer>;

// Пользователи студии. Регистрация → подтверждение почты (ссылка из письма или вход через Google) → аккаунт открыт.
// Ручное подтверждение владельцем — только при MANUAL_APPROVAL=1 или когда письма не настроены.
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
  passHash: string;      // пусто — вход только через Google (пароль можно задать через «Забыли пароль»)
  googleSub?: string;    // идентификатор аккаунта Google, если входил через него
  emailVerified?: number | false; // когда подтверждена почта; false — письмо отправлено, ещё не подтверждена; нет поля — аккаунт создан до проверки почты
  plan?: PlanId;         // пакет: от него зависят лимиты (одновременные генерации, кредиты в сутки)
  status: UserStatus;
  statusReason?: string;
  frozenUntil?: number;  // заморозка на срок; без даты — пока не снимут
  ver: number;           // меняется при бане/смене пароля — старые сессии перестают работать
  createdAt: number;
  createdIp?: string;
  lastLoginAt?: number;
  lastIp?: string;
  verifiedAt?: number;
  verifyNote?: string;   // как подтверждён аккаунт: автоматически (почта, Google) или владельцем (созвон, документ и т.п.)
  consent: { version: string; at: number; ip?: string };
  warnings: UserWarning[];
  blocked: number[];     // время срабатываний модерации провайдеров (последние 50)
  blockedTotal: number;
  dailyLimit?: number;   // устарело ($ в сутки), заменено creditLimit
  creditLimit?: number;  // кредитов в сутки; без значения — USER_DAILY_CREDITS
  souls?: string[];      // свои Soul ID (Higgsfield)
  credits?: number;      // старый баланс (до журнала кредитов); переносится в журнал один раз и больше не меняется
  bal?: number;          // последний известный баланс из журнала — только для отображения в списке
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

const norm = (rec: UserRecord): UserRecord => { rec.warnings ??= []; rec.blocked ??= []; rec.blockedTotal ??= 0; rec.ver ??= 1; return rec; };

export async function getUser(id: string, fresh = false): Promise<UserRecord | null> {
  if (!validUid(id)) return null;
  const hit = cache.get(id);
  if (!fresh && hit && Date.now() - hit.at < TTL) return hit.rec;
  const got = await readPrivateAt<UserRecord>(userPath(id));
  const rec = got ? norm(got.data) : null;
  cache.set(id, { at: Date.now(), rec });
  return rec;
}

export async function findByEmail(email: string): Promise<UserRecord | null> {
  const idx = await readPrivateAt<{ id: string }>(emailPath(email));
  return idx?.data.id ? getUser(idx.data.id, true) : null;
}

// Правка карточки: читаем → меняем → пишем «только если не изменилась» (метка версии R2).
// Копий функции на Vercel несколько, очередь в памяти одной копии от параллельных правок не спасает:
// без этого блокировку мог затереть одновременный пересчёт баланса. Конфликт — перечитываем и повторяем
const chains = new Map<string, Promise<unknown>>();
export function updateUser(id: string, fn: (u: UserRecord) => UserRecord | void): Promise<UserRecord> {
  const prev = chains.get(id) ?? Promise.resolve();
  const run = prev.then(async () => {
    for (let attempt = 0; ; attempt++) {
      const got = validUid(id) ? await readPrivateAt<UserRecord>(userPath(id)) : null;
      if (!got) throw Object.assign(new Error("Пользователь не найден"), { status: 404 });
      const cur = norm(got.data);
      const next = fn(cur) ?? cur;
      try {
        // Последняя попытка — без условия: лучше записать правку, чем потерять её из-за затянувшегося конфликта
        await putPrivateJSONIf(userPath(id), next, attempt < 6 ? got.etag : undefined);
      } catch (e) {
        if ((e as { conflict?: boolean }).conflict && attempt < 6) { await new Promise((r) => setTimeout(r, 40 + Math.random() * 120 * (attempt + 1))); continue; }
        throw e;
      }
      cache.set(id, { at: Date.now(), rec: next });
      usersCache = null;
      return next;
    }
  });
  chains.set(id, run.catch(() => {}));
  if (chains.size > 2000) chains.delete(chains.keys().next().value!);
  return run;
}

export async function createUser(input: Omit<UserRecord, "id" | "passHash" | "status" | "ver" | "createdAt" | "warnings" | "blocked" | "blockedTotal"> & { password?: string }): Promise<UserRecord> {
  const { password, ...rest } = input;
  const rec: UserRecord = {
    ...rest,
    email: normEmail(rest.email),
    id: newUid(),
    passHash: password ? await hashPassword(password) : "",
    status: "pending",
    ver: 1,
    createdAt: Date.now(),
    warnings: [],
    blocked: [],
    blockedTotal: 0,
  };
  autoApprove(rec); // через Google почта уже подтверждена — аккаунт открыт сразу
  await putJSON(userPath(rec.id), rec);
  await putJSON(emailPath(rec.email), { id: rec.id });
  cache.set(rec.id, { at: Date.now(), rec });
  usersCache = null;
  return rec;
}

// ---------- Открытие аккаунта ----------
// Аккаунт открывается сам, как только подтверждена почта: ссылка из письма, вход через Google, сброс пароля по письму.
// MANUAL_APPROVAL=1 возвращает ручное подтверждение владельцем. Без подтверждённой почты (письма не настроены
// или аккаунт создан до них) — тоже вручную: открывать доступ совсем без проверки нельзя
export const manualApproval = () => process.env.MANUAL_APPROVAL === "1";
export const canAutoApprove = (u: UserRecord) => u.status === "pending" && typeof u.emailVerified === "number" && !manualApproval();
export function autoApprove(u: UserRecord): boolean {
  if (!canAutoApprove(u)) return false;
  u.status = "active";
  u.verifiedAt = Date.now();
  u.verifyNote = u.googleSub ? "Автоматически: вход через Google" : "Автоматически: почта подтверждена";
  return true;
}
// Правка карточки, после которой аккаунт может открыться сам, — с записью в журнал модерации
export async function updateUserApproving(id: string, fn: (u: UserRecord) => void): Promise<UserRecord> {
  let opened = false;
  const u = await updateUser(id, (x) => { fn(x); opened = autoApprove(x); });
  if (opened) await logAction({ actor: "system", action: "verify", userId: u.id, email: u.email, reason: u.verifyNote }).catch(() => {});
  return u;
}

// Есть ли кредиты на балансе. Без них генерации и так не запускаются, а всё бесплатное (ассистент, загрузки,
// проверка рефов, Soul ID) ограничено: регистрация открыта, и пустой аккаунт не должен тратить деньги студии
export const hasCredits = (u: UserRecord) => (u.bal ?? u.credits ?? 0) > 0;

let usersCache: { at: number; list: UserRecord[] } | null = null;
export async function listUsers(fresh = false): Promise<UserRecord[]> {
  if (!fresh && usersCache && Date.now() - usersCache.at < 15_000) return usersCache.list;
  const all: UserRecord[] = [];
  let cursor: string | undefined;
  for (let page = 0; page < 20; page++) {
    const r = await listItems("users/", 200, cursor);
    const recs = await Promise.all(r.items.filter((i) => /^users\/u[a-f0-9]{10}\.json$/.test(i.pathname)).map((i) => readJSON<UserRecord>(i)));
    for (const u of recs) if (u) all.push(norm(u));
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
  return { ...rest, credits: u.bal ?? u.credits ?? 0, status: effectiveStatus(u) };
}
