import "server-only";
import { randomUUID } from "crypto";
import { listItems, putPrivateJSON as putJSON, readPrivateJSON as readJSON } from "./storage";

// Журнал модерации: каждое действие с пользователем или генерацией — отдельная неизменяемая запись.
// Пишется дважды: в общий журнал и в журнал пользователя (чтобы быстро открыть историю одного человека).
export type ModAction =
  | "register" | "verify" | "reject" | "warn" | "freeze" | "unfreeze" | "ban" | "unban"
  | "takedown" | "auto_flag" | "auto_freeze" | "limit" | "note" | "login_blocked" | "password"
  | "credit" | "payment_claim";

export type ModEntry = {
  id: string;
  at: number;
  actor: "admin" | "system" | "user";
  action: ModAction;
  userId?: string;
  email?: string;
  jobId?: string;
  reason?: string;
  meta?: Record<string, unknown>;
};

const inv = () => String(9_999_999_999_999 - Date.now()).padStart(13, "0");

export async function logAction(e: Omit<ModEntry, "id" | "at">): Promise<ModEntry> {
  const entry: ModEntry = { ...e, id: `${inv()}_${randomUUID().slice(0, 6)}`, at: Date.now() };
  const writes = [putJSON(`modlog/${entry.id}.json`, entry)];
  if (e.userId) writes.push(putJSON(`u/${e.userId}/log/${entry.id}.json`, entry));
  await Promise.all(writes);
  return entry;
}

export async function listLog(opts: { userId?: string; cursor?: string; limit?: number } = {}): Promise<{ entries: ModEntry[]; cursor?: string }> {
  const prefix = opts.userId ? `u/${opts.userId}/log/` : "modlog/";
  const { items, cursor } = await listItems(prefix, Math.min(opts.limit ?? 50, 100), opts.cursor);
  const entries = (await Promise.all(items.map((i) => readJSON<ModEntry>(i)))).filter(Boolean) as ModEntry[];
  entries.sort((a, b) => b.at - a.at);
  return { entries, cursor };
}
