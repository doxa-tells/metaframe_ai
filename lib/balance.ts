import "server-only";
import { getModel, type ProviderId } from "./models";
import { listJobs } from "./jobs";
import { listItems, putJSON, readJSON } from "./storage";

// Баланс по провайдерам: пользователь вводит текущий остаток, студия вычитает стоимость генераций после этого момента.
// (У Google, BytePlus и Higgsfield нет API остатка по обычным ключам.)
export const PROVIDERS: ProviderId[] = ["google", "byteplus", "higgsfield"];
type Entry = { amount: number; since: number };
type Store = Partial<Record<ProviderId, Entry>>;
export type BalanceRow = { provider: ProviderId; amount: number | null; since: number | null; spent: number; left: number | null; count: number };

const KEY = "settings/balances.json";

async function readStore(): Promise<Store> {
  const { items } = await listItems(KEY, 1);
  const it = items.find((i) => i.pathname === KEY);
  return (it ? await readJSON<Store>(it) : null) ?? {};
}

let cache: { at: number; rows: BalanceRow[] } | null = null;

export async function getBalances(force = false): Promise<BalanceRow[]> {
  if (!force && cache && Date.now() - cache.at < 20_000) return cache.rows;
  const store = await readStore();
  const sinceMin = Math.min(...PROVIDERS.map((p) => store[p]?.since ?? Infinity));
  const spent: Record<string, number> = {};
  const count: Record<string, number> = {};
  if (Number.isFinite(sinceMin)) {
    // Задачи хранятся от новых к старым — листаем, пока не дойдём до самой ранней точки отсчёта
    for (const kind of ["image", "video"] as const) {
      let cursor: string | undefined;
      for (let page = 0; page < 50; page++) {
        const r = await listJobs(kind, cursor);
        let older = false;
        for (const j of r.jobs) {
          if (j.createdAt < sinceMin) { older = true; continue; }
          if (j.status === "failed" || j.status === "canceled" || j.status === "nsfw") continue;
          const p = getModel(j.modelId)?.provider;
          const e = p ? store[p] : undefined;
          if (!p || !e || j.createdAt < e.since) continue;
          spent[p] = (spent[p] ?? 0) + (Number(j.cost) || 0);
          count[p] = (count[p] ?? 0) + 1;
        }
        if (older || !r.cursor) break;
        cursor = r.cursor;
      }
    }
  }
  const rows = PROVIDERS.map((p): BalanceRow => {
    const e = store[p];
    const s = Math.round((spent[p] ?? 0) * 10000) / 10000;
    return { provider: p, amount: e?.amount ?? null, since: e?.since ?? null, spent: s, left: e ? Math.round((e.amount - s) * 100) / 100 : null, count: count[p] ?? 0 };
  });
  cache = { at: Date.now(), rows };
  return rows;
}

export async function setBalance(provider: ProviderId, amount: number | null): Promise<BalanceRow[]> {
  const store = await readStore();
  if (amount === null) delete store[provider];
  else store[provider] = { amount: Math.round(amount * 100) / 100, since: Date.now() };
  await putJSON(KEY, store);
  cache = null;
  return getBalances(true);
}
