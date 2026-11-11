import "server-only";
import { createHash, randomUUID } from "crypto";
import { deleteItems, listItems, putPrivateJSON, readPrivateJSON, type StoredItem } from "./storage";

// Журнал кредитов: каждое движение — отдельный файл, который больше не меняется.
// Сумма и тип записаны прямо в имени файла, поэтому баланс = сумма по списку файлов (без чтения содержимого).
// Ключи детерминированы: списание и возврат по одной задаче — это всегда один и тот же файл,
// поэтому повторный или параллельный возврат ничего не удваивает, а удаление задачи не стирает историю.
//   init~migrate~p120          — перенос старого баланса из карточки пользователя (один раз)
//   charge~<jobId>~m7          — списание за генерацию
//   refund~<jobId>~p7          — возврат (ошибка, модерация, отмена, недодано картинок)
//   pay~<ts>-<чек>~p1000       — оплата по чеку (номер чека уникален на весь сервис)
//   adj~<ts>-<rand>~m50        — ручная корректировка владельцем

export type LedgerType = "init" | "charge" | "refund" | "pay" | "adj";
export type LedgerEntry = { type: LedgerType; ref: string; amount: number; at?: number; pathname: string };
export type LedgerBody = { type: LedgerType; ref: string; amount: number; at: number; by?: string; note?: string };

const DAY = 86_400_000;
const r2 = (n: number) => Math.round(n * 100) / 100;
const root = (uid: string) => `u/${uid}/ledger/`;
const fmt = (n: number) => `${n < 0 ? "m" : "p"}${r2(Math.abs(n))}`;
const keyOf = (uid: string, type: LedgerType, ref: string, amount: number) => `${root(uid)}${type}~${ref}~${fmt(amount)}`;
const NAME = /^(init|charge|refund|pay|adj)~([^~/]+)~([pm])(\d+(?:\.\d+)?)$/;

// Время записи: у задач — из id (обратная метка), у оплат и корректировок — префикс ссылки
function tsOf(type: LedgerType, ref: string): number | undefined {
  if (type === "charge" || type === "refund") {
    const m = /_(\d{13})_/.exec(ref);
    return m ? 9_999_999_999_999 - Number(m[1]) : undefined;
  }
  const m = /^(\d{13})-/.exec(ref);
  return m ? Number(m[1]) : undefined;
}

function parse(it: StoredItem): LedgerEntry | null {
  const name = it.pathname.slice(it.pathname.lastIndexOf("/") + 1);
  const m = NAME.exec(name);
  if (!m) return null;
  const type = m[1] as LedgerType;
  const amount = (m[3] === "m" ? -1 : 1) * Number(m[4]);
  return { type, ref: m[2], amount, at: tsOf(type, m[2]), pathname: it.pathname };
}

async function listEntries(uid: string, sub = ""): Promise<{ entries: LedgerEntry[]; items: Map<string, StoredItem> }> {
  const entries: LedgerEntry[] = [];
  const items = new Map<string, StoredItem>();
  let cursor: string | undefined;
  for (let page = 0; page < 50; page++) {
    const r = await listItems(root(uid) + sub, 1000, cursor);
    for (const it of r.items) {
      const e = parse(it);
      if (e) { entries.push(e); items.set(e.pathname, it); }
    }
    if (!r.cursor) break;
    cursor = r.cursor;
  }
  return { entries, items };
}

export type LedgerSummary = { balance: number; dayCharged: number; entries: LedgerEntry[] };

function summarize(entries: LedgerEntry[], now = Date.now()): LedgerSummary {
  let balance = 0, day = 0;
  for (const e of entries) {
    balance += e.amount;
    // Суточный расход — списания минус возвраты по задачам за последние 24 часа
    if ((e.type === "charge" || e.type === "refund") && e.at && now - e.at < DAY) day -= e.amount;
  }
  return { balance: r2(balance), dayCharged: r2(Math.max(0, day)), entries };
}

async function write(uid: string, type: LedgerType, ref: string, amount: number, extra: { by?: string; note?: string } = {}): Promise<string> {
  const p = keyOf(uid, type, ref, amount);
  const body: LedgerBody = { type, ref, amount: r2(amount), at: Date.now(), ...extra };
  await putPrivateJSON(p, body);
  return p;
}

// Старый баланс из карточки переносится в журнал один раз; ключ зависит только от этой (больше не меняющейся) суммы
async function ensureInit(uid: string, legacy: number, entries: LedgerEntry[]): Promise<LedgerEntry[]> {
  if (entries.some((e) => e.type === "init")) return entries;
  const amount = r2(Math.max(0, legacy || 0));
  const pathname = await write(uid, "init", "migrate", amount, { note: "перенос баланса" });
  return [...entries, { type: "init", ref: "migrate", amount, pathname }];
}

export async function ledgerSummary(uid: string, legacy = 0): Promise<LedgerSummary> {
  const { entries } = await listEntries(uid);
  return summarize(await ensureInit(uid, legacy, entries));
}

const err = (message: string, status: number) => Object.assign(new Error(message), { status });

// Списание за задачу. Проверка → запись → повторная проверка: если параллельные списания увели баланс
// в минус, своё списание откатываем (в худшем случае откажут оба запроса, но перерасхода не будет)
export async function charge(uid: string, jobId: string, n: number, opts: { legacy?: number; dayLimit?: number } = {}): Promise<LedgerSummary> {
  const before = await ledgerSummary(uid, opts.legacy);
  if (!(n > 0)) return before;
  const insufficient = (bal: number) => err(`Недостаточно кредитов: нужно ${r2(n)}, на балансе ${r2(Math.max(0, bal))}. Пополните баланс в разделе «Кредиты»`, 402);
  if (before.balance + 1e-9 < n) throw insufficient(before.balance);
  if (opts.dayLimit !== undefined && before.dayCharged + n > opts.dayLimit + 1e-9) {
    throw err(`Суточный лимит ${opts.dayLimit} кредитов исчерпан (списано ${before.dayCharged} за 24 часа). Попробуйте позже или напишите владельцу, чтобы поднять лимит`, 429);
  }
  const p = await write(uid, "charge", jobId, -n);
  const { entries, items } = await listEntries(uid);
  const after = summarize(entries);
  if (after.balance < -1e-9) {
    const it = items.get(p);
    if (it) await deleteItems([it]).catch(() => {});
    throw insufficient(before.balance);
  }
  return after;
}

// Возврат по задаче: не больше одного на задачу, сколько бы раз его ни вызывали
export async function refund(uid: string, jobId: string, n: number, note?: string): Promise<boolean> {
  if (!(n > 0)) return false;
  const { entries } = await listEntries(uid, `refund~${jobId}~`);
  if (entries.length) return false;
  // Возвращать можно только то, что реально списано по этой задаче
  const ch = await listEntries(uid, `charge~${jobId}~`);
  let charged = ch.entries.reduce((s, e) => s - e.amount, 0);
  if (!ch.entries.length) {
    // Задача запущена до перехода на журнал: списание было в старом балансе, который уже перенесён
    const init = await listEntries(uid, "init~");
    const it = init.entries[0] && init.items.get(init.entries[0].pathname);
    const body = it ? await readPrivateJSON<LedgerBody>(it) : null;
    const at = tsOf("charge", jobId);
    if (body && at && at < body.at) charged = n;
  }
  const amount = r2(Math.min(n, charged));
  if (!(amount > 0)) return false;
  await write(uid, "refund", jobId, amount, { note });
  return true;
}

const cleanReceipt = (s: string) => s.trim().replace(/[^\p{L}\p{N}_-]+/gu, "-").replace(/^-+|-+$/g, "").slice(0, 64);
const receiptPath = (r: string) => `receipts/${createHash("sha256").update(r.toLowerCase()).digest("hex").slice(0, 40)}.json`;

// Начисление или списание владельцем. С номером чека — оплата: один чек нельзя учесть дважды (ни этому, ни другому пользователю)
export async function adjust(uid: string, amount: number, opts: { receipt?: string; by?: string; note?: string; legacy?: number }): Promise<LedgerSummary> {
  if (!Number.isFinite(amount) || amount === 0) throw err("Укажите количество кредитов", 400);
  const sum = await ledgerSummary(uid, opts.legacy);
  if (amount < 0 && sum.balance + amount < -1e-9) throw err(`Нельзя списать ${-amount}: на балансе ${sum.balance}`, 400);
  const ts = Date.now();
  const receipt = opts.receipt ? cleanReceipt(opts.receipt) : "";
  if (receipt) {
    if (amount < 0) throw err("Номер чека указывается только для начисления", 400);
    const rp = receiptPath(receipt);
    const { items } = await listItems(rp, 1);
    const it = items.find((i) => i.pathname === rp);
    if (it) {
      const prev = await readPrivateJSON<{ uid: string; amount: number; at: number }>(it);
      throw err(`Чек ${receipt} уже учтён${prev ? ` (${prev.uid === uid ? "этому пользователю" : `пользователю ${prev.uid}`}, ${prev.amount} кредитов, ${new Date(prev.at).toLocaleString("ru-RU", { timeZone: "Asia/Almaty" })})` : ""}`, 409);
    }
    await putPrivateJSON(rp, { uid, amount, at: ts });
    await write(uid, "pay", `${ts}-${receipt}`, amount, { by: opts.by, note: opts.note });
  } else {
    await write(uid, "adj", `${ts}-${randomUUID().slice(0, 6)}`, amount, { by: opts.by, note: opts.note });
  }
  return ledgerSummary(uid, opts.legacy);
}

// История для владельца: последние движения с заметками
export async function ledgerHistory(uid: string, limit = 60): Promise<(LedgerEntry & { note?: string; by?: string })[]> {
  const { entries, items } = await listEntries(uid);
  const sorted = [...entries].sort((a, b) => (b.at ?? 0) - (a.at ?? 0)).slice(0, limit);
  return Promise.all(sorted.map(async (e) => {
    if (e.type === "charge" || e.type === "refund") return e;
    const it = items.get(e.pathname);
    const b = it ? await readPrivateJSON<LedgerBody>(it) : null;
    return { ...e, at: e.at ?? b?.at, note: b?.note, by: b?.by };
  }));
}
