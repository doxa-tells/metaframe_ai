import "server-only";
import { randomUUID } from "crypto";
import { humanizeError } from "./errors";
import { listJobs, removeOutputs, jobScope, parseJobId, type JobRecord } from "./jobs";
import { logAction, type ModAction } from "./modlog";
import { putPrivateJSON, listItems, readJSON } from "./storage";
import { defaultDailyLimit, effectiveStatus, getUser, updateUser, type UserRecord } from "./users";

const DAY = 86_400_000;
const autoFreezeAt = () => {
  const n = Number(process.env.USER_AUTO_FREEZE);
  return Number.isFinite(n) && n > 0 ? n : 10;
};

// Генерация пользователя не прошла модерацию провайдера — отмечаем; слишком часто — замораживаем на сутки
export async function noteBlocked(rec: JobRecord): Promise<void> {
  if (!rec.userId) return;
  const h = humanizeError(rec.status, rec.error);
  if (h.kind !== "censor" && h.kind !== "copyright") return;
  const now = Date.now();
  let freeze = false;
  const user = await updateUser(rec.userId, (u) => {
    u.blocked = [...(u.blocked ?? []), now].slice(-50);
    u.blockedTotal = (u.blockedTotal ?? 0) + 1;
    const recent = u.blocked.filter((t) => now - t < DAY).length;
    if (effectiveStatus(u) === "active" && recent >= autoFreezeAt()) {
      freeze = true;
      u.status = "frozen";
      u.frozenUntil = now + DAY;
      u.statusReason = `Автоматически: ${recent} генераций за сутки не прошли модерацию. Владелец проверит аккаунт`;
    }
  });
  await logAction({
    actor: "system", action: "auto_flag", userId: rec.userId, email: user.email, jobId: rec.id,
    reason: `${h.title}: ${h.text}`,
    meta: { modelId: rec.modelId, prompt: rec.prompt.slice(0, 500), raw: (rec.error ?? "").slice(0, 300), ip: rec.ip },
  });
  if (freeze) await logAction({ actor: "system", action: "auto_freeze", userId: rec.userId, email: user.email, reason: `${autoFreezeAt()}+ блокировок модерацией за сутки, заморозка на 24 часа` });
}

// Траты пользователя за последние сутки (по оценке стоимости; неудачные не считаются)
export async function spentLastDay(uid: string): Promise<number> {
  const since = Date.now() - DAY;
  let sum = 0;
  for (const kind of ["image", "video"] as const) {
    let cursor: string | undefined;
    for (let page = 0; page < 10; page++) {
      const r = await listJobs(kind, cursor, uid);
      let older = false;
      for (const j of r.jobs) {
        if (j.createdAt < since) { older = true; continue; }
        if (j.status === "failed" || j.status === "canceled" || j.status === "nsfw") continue;
        sum += Number(j.cost) || 0;
      }
      if (older || !r.cursor) break;
      cursor = r.cursor;
    }
  }
  return Math.round(sum * 100) / 100;
}

export const limitOf = (u: UserRecord) => u.dailyLimit ?? defaultDailyLimit();

export async function assertWithinLimit(u: UserRecord, cost: number): Promise<void> {
  const limit = limitOf(u);
  const spent = await spentLastDay(u.id);
  if (spent + cost > limit + 1e-9) {
    throw Object.assign(new Error(`Суточный лимит $${limit} исчерпан (потрачено $${spent.toFixed(2)} за 24 часа). Попробуйте позже или попросите владельца поднять лимит`), { status: 429 });
  }
}

export type AdminAction = "verify" | "reject" | "warn" | "freeze" | "unfreeze" | "ban" | "unban" | "limit" | "note";

export async function applyAction(uid: string, action: AdminAction, opts: { reason?: string; days?: number; limit?: number | null; jobId?: string }): Promise<UserRecord> {
  const reason = (opts.reason ?? "").trim().slice(0, 1000);
  const needReason: AdminAction[] = ["reject", "warn", "freeze", "ban"];
  if (needReason.includes(action) && !reason) throw Object.assign(new Error("Укажите причину"), { status: 400 });
  const now = Date.now();
  const u = await updateUser(uid, (u) => {
    switch (action) {
      case "verify":
        u.status = "active"; u.verifiedAt = now; u.verifyNote = reason || u.verifyNote; u.statusReason = undefined; u.frozenUntil = undefined; break;
      case "reject":
        u.status = "rejected"; u.statusReason = reason; break;
      case "warn":
        u.warnings = [...(u.warnings ?? []), { id: randomUUID().slice(0, 8), at: now, reason, ...(opts.jobId ? { jobId: opts.jobId } : {}) }].slice(-50); break;
      case "freeze":
        u.status = "frozen"; u.statusReason = reason; u.frozenUntil = opts.days && opts.days > 0 ? now + opts.days * DAY : undefined; break;
      case "unfreeze":
        u.status = u.verifiedAt ? "active" : "pending"; u.statusReason = undefined; u.frozenUntil = undefined; break;
      case "ban":
        u.status = "banned"; u.statusReason = reason; u.ver = (u.ver ?? 1) + 1; break; // все сессии сразу недействительны
      case "unban":
        u.status = u.verifiedAt ? "active" : "pending"; u.statusReason = undefined; u.frozenUntil = undefined; break;
      case "limit":
        u.dailyLimit = opts.limit === null || opts.limit === undefined ? undefined : Math.max(0, Math.min(10000, opts.limit)); break;
      case "note":
        u.note = reason || undefined; break;
    }
  });
  await logAction({
    actor: "admin", action: action as ModAction, userId: uid, email: u.email, jobId: opts.jobId, reason: reason || undefined,
    meta: action === "freeze" ? { days: opts.days ?? null } : action === "limit" ? { limit: u.dailyLimit ?? null } : undefined,
  });
  return u;
}

// Снять генерацию: результаты удаляются у пользователя, запись задачи сохраняется в карантине для разбирательств
export async function takedown(jobId: string, opts: { indexes?: number[]; reason: string; warn?: boolean }): Promise<string> {
  const p = parseJobId(jobId);
  if (!p) throw Object.assign(new Error("Некорректный id"), { status: 400 });
  const reason = opts.reason.trim().slice(0, 1000);
  if (!reason) throw Object.assign(new Error("Укажите причину"), { status: 400 });
  const prefix = `${p.uid ? `u/${p.uid}/jobs/` : "jobs/"}${p.kind}/${p.base}.`;
  const { items } = await listItems(prefix, 10);
  const it = items.find((i) => i.pathname.endsWith(".d.json")) ?? items[0];
  const rec = it ? await readJSON<JobRecord>(it) : null;
  if (rec) await putPrivateJSON(`quarantine/${jobId}.json`, { ...rec, takedown: { at: Date.now(), reason, indexes: opts.indexes ?? null } });
  const result = await removeOutputs(jobId, opts.indexes);
  const uid = jobScope(jobId) || undefined;
  const user = uid ? await getUser(uid) : null;
  await logAction({
    actor: "admin", action: "takedown", userId: uid, email: user?.email, jobId, reason,
    meta: rec ? { modelId: rec.modelId, prompt: rec.prompt.slice(0, 500), inputs: rec.inputs, outputs: rec.outputs.map((o) => o.url), indexes: opts.indexes ?? null, ip: rec.ip } : undefined,
  });
  if (uid && opts.warn) await applyAction(uid, "warn", { reason: `Снята генерация: ${reason}`, jobId });
  return result;
}
