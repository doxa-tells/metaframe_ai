"use client";
import { useCallback, useEffect, useMemo, useState } from "react";
import { withBase } from "@/lib/base";
import { thumbOf, type Job } from "@/lib/client";
import { getModel } from "@/lib/models";
import { humanizeError } from "@/lib/errors";
import { Icon } from "./Icon";

type Status = "pending" | "active" | "frozen" | "banned" | "rejected";
type Warn = { id: string; at: number; reason: string; jobId?: string; ack?: number };
type User = {
  id: string; email: string; name: string; phone: string; country: string; purpose: string; status: Status;
  statusReason?: string; frozenUntil?: number; createdAt: number; createdIp?: string; lastLoginAt?: number; lastIp?: string;
  verifiedAt?: number; verifyNote?: string; consent?: { version: string; at: number; ip?: string };
  warnings: Warn[]; blockedTotal: number; blockedDay?: number; dailyLimit?: number; note?: string; souls?: string[];
};
type Entry = { id: string; at: number; actor: string; action: string; userId?: string; email?: string; jobId?: string; reason?: string; meta?: Record<string, unknown> };

const STATUS: Record<Status, string> = { pending: "На проверке", active: "Активен", frozen: "Заморожен", banned: "Заблокирован", rejected: "Отклонён" };
const ACTION: Record<string, string> = {
  register: "Регистрация", verify: "Личность подтверждена", reject: "Заявка отклонена", warn: "Предупреждение", freeze: "Заморозка",
  unfreeze: "Разморозка", ban: "Блокировка", unban: "Разблокировка", takedown: "Снята генерация", auto_flag: "Модерация провайдера",
  auto_freeze: "Автозаморозка", limit: "Лимит", note: "Заметка", login_blocked: "Вход при бане", password: "Пароль",
};
const FILTERS: { id: string; label: string; match: (u: User) => boolean }[] = [
  { id: "pending", label: "На проверке", match: (u) => u.status === "pending" },
  { id: "flagged", label: "С нарушениями", match: (u) => (u.blockedDay ?? 0) > 0 || u.status === "frozen" },
  { id: "active", label: "Активные", match: (u) => u.status === "active" },
  { id: "blocked", label: "Заблокированные", match: (u) => u.status === "banned" || u.status === "rejected" },
  { id: "all", label: "Все", match: () => true },
];

const dt = (t?: number) => (t ? new Date(t).toLocaleString("ru-RU", { day: "2-digit", month: "2-digit", year: "2-digit", hour: "2-digit", minute: "2-digit" }) : "—");

async function call<T>(path: string, init?: RequestInit): Promise<T> {
  const r = await fetch(withBase(path), { cache: "no-store", ...init, headers: init?.body ? { "Content-Type": "application/json" } : undefined });
  const d = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error((d as { error?: string }).error ?? `Ошибка ${r.status}`);
  return d as T;
}

export function AdminPanel() {
  const [tab, setTab] = useState<"users" | "log">("users");
  const [users, setUsers] = useState<User[] | null>(null);
  const [filter, setFilter] = useState("pending");
  const [search, setSearch] = useState("");
  const [sel, setSel] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [lookup, setLookup] = useState("");
  const [focusJob, setFocusJob] = useState<string | null>(null);

  const loadUsers = useCallback(async (fresh = false) => {
    try {
      const d = await call<{ users: User[] }>(`/api/admin/users${fresh ? "?fresh=1" : ""}`);
      setUsers(d.users);
    } catch (e) { setErr((e as Error).message); }
  }, []);
  useEffect(() => { loadUsers(true); }, [loadUsers]);

  // Первый раз открываем раздел с заявками, если они есть, иначе — всех
  const [autoFilter, setAutoFilter] = useState(true);
  useEffect(() => {
    if (!users || !autoFilter) return;
    setAutoFilter(false);
    if (!users.some((u) => u.status === "pending")) setFilter("all");
  }, [users, autoFilter]);

  const counts = useMemo(() => Object.fromEntries(FILTERS.map((f) => [f.id, (users ?? []).filter(f.match).length])), [users]);
  const shown = useMemo(() => {
    const q = search.trim().toLowerCase();
    const f = FILTERS.find((x) => x.id === filter) ?? FILTERS[4];
    return (users ?? []).filter((u) => (q ? `${u.name} ${u.email} ${u.phone} ${u.id}`.toLowerCase().includes(q) : f.match(u)));
  }, [users, filter, search]);

  async function doLookup(e: React.FormEvent) {
    e.preventDefault();
    setErr(null);
    try {
      const d = await call<{ uid?: string | null; jobId?: string; owner?: boolean }>(`/api/admin/lookup?q=${encodeURIComponent(lookup.trim())}`);
      if (d.owner) { setErr("Это ваша собственная генерация"); return; }
      if (d.uid) { setTab("users"); setSel(d.uid); setFocusJob(d.jobId ?? null); }
    } catch (e2) { setErr((e2 as Error).message); }
  }

  const onChanged = (u: User) => setUsers((list) => (list ?? []).map((x) => (x.id === u.id ? { ...x, ...u } : x)));

  return (
    <div className="admin">
      <div className="admin-top">
        <div className="seg">
          <button className={tab === "users" ? "on" : ""} onClick={() => setTab("users")}>Пользователи{counts.pending ? <span className="badge">{counts.pending}</span> : null}</button>
          <button className={tab === "log" ? "on" : ""} onClick={() => setTab("log")}>Журнал модерации</button>
        </div>
        <form className="admin-lookup" onSubmit={doLookup}>
          <input type="text" placeholder="Почта, id или ссылка на генерацию" value={lookup} onChange={(e) => setLookup(e.target.value)} />
          <button className="btn small" disabled={!lookup.trim()}>Найти</button>
        </form>
      </div>
      {err && <div className="banner warn admin-err" onClick={() => setErr(null)}>{err}</div>}

      {tab === "log" ? (
        <LogList onOpenUser={(uid) => { setTab("users"); setSel(uid); }} />
      ) : (
        <div className={`admin-body ${sel ? "has-sel" : ""}`}>
          <aside className="admin-list">
            <div className="admin-filters">
              {FILTERS.map((f) => (
                <button key={f.id} className={`chip ${filter === f.id && !search ? "on" : ""}`} onClick={() => { setFilter(f.id); setSearch(""); }}>
                  {f.label} <span className="muted">{counts[f.id] ?? 0}</span>
                </button>
              ))}
            </div>
            <input type="text" placeholder="Поиск по имени, почте, телефону" value={search} onChange={(e) => setSearch(e.target.value)} />
            {!users && <div className="muted small pad">Загружаю…</div>}
            {users && !shown.length && <div className="muted small pad">Никого нет</div>}
            {shown.map((u) => (
              <button key={u.id} className={`admin-user ${sel === u.id ? "on" : ""}`} onClick={() => { setSel(u.id); setFocusJob(null); }}>
                <div className="row between gap8"><b className="ellipsis">{u.name}</b><span className={`st st-${u.status}`}>{STATUS[u.status]}</span></div>
                <div className="row between gap8 small muted"><span className="ellipsis">{u.email}</span><span>{dt(u.createdAt).slice(0, 8)}</span></div>
                {(u.blockedDay ?? 0) > 0 && <div className="small flag">Модерация за сутки: {u.blockedDay}</div>}
              </button>
            ))}
          </aside>
          <section className="admin-detail">
            {sel ? <UserDetail key={sel} uid={sel} focusJob={focusJob} onChanged={onChanged} onClose={() => setSel(null)} /> : <div className="muted pad">Выберите пользователя слева</div>}
          </section>
        </div>
      )}
    </div>
  );
}

function UserDetail({ uid, focusJob, onChanged, onClose }: { uid: string; focusJob: string | null; onChanged: (u: User) => void; onClose: () => void }) {
  const [u, setU] = useState<User | null>(null);
  const [limit, setLimit] = useState<number | null>(null);
  const [spent, setSpent] = useState<number | null>(null);
  const [reason, setReason] = useState("");
  const [days, setDays] = useState("7");
  const [limitIn, setLimitIn] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [logRev, setLogRev] = useState(0);

  useEffect(() => {
    call<{ user: User; limit: number; spent: number }>(`/api/admin/users/${uid}`)
      .then((d) => { setU(d.user); setLimit(d.limit); setSpent(d.spent); setLimitIn(d.user.dailyLimit !== undefined ? String(d.user.dailyLimit) : ""); })
      .catch((e) => setMsg((e as Error).message));
  }, [uid]);

  async function act(action: string, extra: Record<string, unknown> = {}, confirmText?: string) {
    if (confirmText && !window.confirm(confirmText)) return;
    setBusy(true); setMsg(null);
    try {
      const d = await call<{ user: User; limit: number }>(`/api/admin/users/${uid}`, { method: "POST", body: JSON.stringify({ action, reason, ...extra }) });
      setU(d.user); setLimit(d.limit); onChanged(d.user);
      if (action !== "limit") setReason("");
      setMsg("Сохранено");
      setLogRev((r) => r + 1);
    } catch (e) { setMsg((e as Error).message); }
    setBusy(false);
  }

  if (!u) return <div className="muted pad">{msg ?? "Загружаю…"}</div>;
  const st = u.status;
  const reasonHint = st === "pending" ? "Как подтверждена личность (созвон, документ…) или причина отказа" : "Причина — пользователь её увидит (для предупреждения, заморозки, бана)";

  return (
    <div className="ud">
      <div className="ud-head">
        <button className="iconbtn ud-back" onClick={onClose} title="К списку"><Icon name="back" /></button>
        <div className="grow">
          <div className="row gap8"><h2>{u.name}</h2><span className={`st st-${st}`}>{STATUS[st]}</span></div>
          <div className="muted small">{u.id}</div>
        </div>
      </div>

      <div className="ud-grid">
        <div><span>Почта</span><a href={`mailto:${u.email}`}>{u.email}</a></div>
        <div><span>Телефон</span><a href={`tel:${u.phone.replace(/[^\d+]/g, "")}`}>{u.phone}</a></div>
        <div><span>Страна</span>{u.country}</div>
        <div><span>Регистрация</span>{dt(u.createdAt)} · {u.createdIp ?? "IP ?"}</div>
        <div><span>Последний вход</span>{dt(u.lastLoginAt)}{u.lastIp ? ` · ${u.lastIp}` : ""}</div>
        <div><span>Согласие с правилами</span>{u.consent ? `${u.consent.version}, ${dt(u.consent.at)}` : "—"}</div>
        <div><span>Личность подтверждена</span>{u.verifiedAt ? `${dt(u.verifiedAt)}${u.verifyNote ? ` — ${u.verifyNote}` : ""}` : "нет"}</div>
        <div><span>Расход за 24 ч</span>${(spent ?? 0).toFixed(2)} из ${limit ?? "?"}</div>
        <div><span>Модерация провайдеров</span>{u.blockedTotal} всего · {u.blockedDay ?? 0} за сутки</div>
        {u.statusReason && <div className="wide"><span>Причина статуса</span>{u.statusReason}{u.frozenUntil ? ` (до ${dt(u.frozenUntil)})` : ""}</div>}
        {u.purpose && <div className="wide"><span>Цель</span>{u.purpose}</div>}
        {u.note && <div className="wide"><span>Заметка</span>{u.note}</div>}
      </div>

      <div className="ud-actions">
        <textarea rows={2} placeholder={reasonHint} value={reason} onChange={(e) => setReason(e.target.value)} />
        <div className="ud-btns">
          {(st === "pending" || st === "rejected") && <button className="btn accent small" disabled={busy} onClick={() => act("verify")}>Подтвердить личность</button>}
          {st === "pending" && <button className="btn small" disabled={busy || !reason.trim()} onClick={() => act("reject")}>Отклонить</button>}
          {(st === "active" || st === "frozen") && <button className="btn small" disabled={busy || !reason.trim()} onClick={() => act("warn")}>Предупредить</button>}
          {st === "active" && (
            <span className="ud-freeze">
              <select value={days} onChange={(e) => setDays(e.target.value)}>
                <option value="1">1 день</option><option value="3">3 дня</option><option value="7">7 дней</option><option value="30">30 дней</option><option value="0">бессрочно</option>
              </select>
              <button className="btn small" disabled={busy || !reason.trim()} onClick={() => act("freeze", { days: Number(days) })}>Заморозить</button>
            </span>
          )}
          {st === "frozen" && <button className="btn small" disabled={busy} onClick={() => act("unfreeze")}>Разморозить</button>}
          {st !== "banned" && <button className="btn danger small" disabled={busy || !reason.trim()} onClick={() => act("ban", {}, `Заблокировать ${u.name}? Все его сессии сразу закроются.`)}>Заблокировать</button>}
          {st === "banned" && <button className="btn small" disabled={busy} onClick={() => act("unban")}>Разблокировать</button>}
          <button className="btn small" disabled={busy || !reason.trim()} onClick={() => act("note")} title="Сохранить текст как заметку (пользователь не видит)">Заметка</button>
        </div>
        <div className="ud-limit">
          <span className="small muted">Лимит $ в сутки</span>
          <input type="number" min={0} step={1} placeholder={`по умолчанию ${limit ?? ""}`} value={limitIn} onChange={(e) => setLimitIn(e.target.value)} />
          <button className="btn small" disabled={busy} onClick={() => act("limit", { limit: limitIn.trim() === "" ? null : Number(limitIn) })}>Сохранить</button>
        </div>
        {msg && <div className="small muted">{msg}</div>}
      </div>

      {u.warnings.length > 0 && (
        <div className="ud-block">
          <h3>Предупреждения</h3>
          {[...u.warnings].reverse().map((w) => (
            <div key={w.id} className="ud-warn small"><b>{dt(w.at)}</b> {w.reason} <span className="muted">{w.ack ? `· прочитано ${dt(w.ack)}` : "· не прочитано"}</span></div>
          ))}
        </div>
      )}

      <UserJobs uid={uid} focusJob={focusJob} reason={reason} onTakedown={() => setLogRev((r) => r + 1)} />

      <div className="ud-block">
        <h3>История</h3>
        <LogList uid={uid} rev={logRev} compact />
      </div>
    </div>
  );
}

function UserJobs({ uid, focusJob, reason, onTakedown }: { uid: string; focusJob: string | null; reason: string; onTakedown: () => void }) {
  const [kind, setKind] = useState<"image" | "video">(focusJob?.startsWith("video_") ? "video" : "image");
  const [jobs, setJobs] = useState<Job[]>([]);
  const [cursor, setCursor] = useState<string | undefined>();
  const [loading, setLoading] = useState(false);
  const [warn, setWarn] = useState(true);
  const [err, setErr] = useState<string | null>(null);

  const load = useCallback(async (k: "image" | "video", c?: string) => {
    setLoading(true);
    try {
      const d = await call<{ jobs: Job[]; cursor?: string }>(`/api/admin/jobs?uid=${uid}&kind=${k}${c ? `&cursor=${encodeURIComponent(c)}` : ""}`);
      setJobs((prev) => (c ? [...prev, ...d.jobs] : d.jobs));
      setCursor(d.cursor);
    } catch (e) { setErr((e as Error).message); }
    setLoading(false);
  }, [uid]);
  useEffect(() => { load(kind); }, [kind, load]);

  async function takedown(j: Job) {
    if (!reason.trim()) { setErr("Сначала напишите причину в поле выше"); return; }
    if (!window.confirm(`Снять генерацию? Результаты удалятся у пользователя${warn ? ", он получит предупреждение" : ""}.`)) return;
    setErr(null);
    try {
      await call(`/api/admin/takedown`, { method: "POST", body: JSON.stringify({ id: j.id, reason, warn }) });
      setJobs((list) => list.filter((x) => x.id !== j.id));
      onTakedown();
    } catch (e) { setErr((e as Error).message); }
  }

  return (
    <div className="ud-block">
      <div className="row between gap8">
        <h3>Генерации</h3>
        <div className="row gap8">
          <label className="small row gap4"><input type="checkbox" checked={warn} onChange={(e) => setWarn(e.target.checked)} /> при снятии — предупреждение</label>
          <div className="seg small">
            <button className={kind === "image" ? "on" : ""} onClick={() => setKind("image")}>Фото</button>
            <button className={kind === "video" ? "on" : ""} onClick={() => setKind("video")}>Видео</button>
          </div>
        </div>
      </div>
      {err && <div className="err small">{err}</div>}
      <div className="ud-jobs">
        {jobs.map((j) => {
          const o = j.outputs[0];
          const bad = j.status !== "completed" && j.status !== "queued" && j.status !== "in_progress";
          const h = bad ? humanizeError(j.status, j.error) : null;
          return (
            <div key={j.id} className={`ud-job ${focusJob === j.id ? "focus" : ""}`}>
              <div className="ud-job-media">
                {o ? (o.type === "video" ? <video src={o.url} muted playsInline preload="metadata" controls /> : <a href={o.url} target="_blank" rel="noreferrer"><img src={thumbOf(o)} alt="" loading="lazy" /></a>)
                  : <div className={`ud-job-empty ${h?.kind === "censor" || h?.kind === "copyright" ? "censor" : ""}`}>{h ? h.title : "…"}</div>}
                {j.outputs.length > 1 && <span className="ud-count">{j.outputs.length}</span>}
              </div>
              <div className="ud-job-meta small">
                <div className="row between gap4"><b className="ellipsis">{getModel(j.modelId)?.name ?? j.modelId}</b><span className="muted">{dt(j.createdAt)}</span></div>
                <div className="ud-prompt" title={j.prompt}>{j.prompt || <span className="muted">без промпта</span>}</div>
                {Object.values(j.inputs ?? {}).flat().filter(Boolean).length > 0 && (
                  <div className="ud-refs">
                    {Object.values(j.inputs).flat().filter(Boolean).slice(0, 6).map((r) => <a key={r} href={r} target="_blank" rel="noreferrer">реф</a>)}
                  </div>
                )}
                <div className="row between gap4">
                  <span className="muted">${Number(j.cost || 0).toFixed(2)}{j.ip ? ` · ${j.ip}` : ""}</span>
                  <button className="btn danger tiny" onClick={() => takedown(j)}>Снять</button>
                </div>
              </div>
            </div>
          );
        })}
      </div>
      {!loading && !jobs.length && <div className="muted small">Пока ничего</div>}
      {cursor && <button className="btn small" disabled={loading} onClick={() => load(kind, cursor)}>{loading ? "Загружаю…" : "Ещё"}</button>}
    </div>
  );
}

function LogList({ uid, rev = 0, compact, onOpenUser }: { uid?: string; rev?: number; compact?: boolean; onOpenUser?: (uid: string) => void }) {
  const [entries, setEntries] = useState<Entry[]>([]);
  const [cursor, setCursor] = useState<string | undefined>();
  const [loading, setLoading] = useState(false);
  const load = useCallback(async (c?: string) => {
    setLoading(true);
    try {
      const d = await call<{ entries: Entry[]; cursor?: string }>(`/api/admin/log?${uid ? `uid=${uid}&` : ""}${c ? `cursor=${encodeURIComponent(c)}` : ""}`);
      setEntries((prev) => (c ? [...prev, ...d.entries] : d.entries));
      setCursor(d.cursor);
    } catch { /* пусто */ }
    setLoading(false);
  }, [uid]);
  useEffect(() => { load(); }, [load, rev]);

  return (
    <div className={`modlog ${compact ? "compact" : ""}`}>
      {entries.map((e) => (
        <div key={e.id} className={`ml-row ml-${e.action}`}>
          <span className="ml-at">{dt(e.at)}</span>
          <span className="ml-act">{ACTION[e.action] ?? e.action}<span className="muted"> · {e.actor === "admin" ? "владелец" : e.actor === "system" ? "система" : "пользователь"}</span></span>
          {!compact && (e.email || e.userId) && <button className="linkbtn ml-user" onClick={() => e.userId && onOpenUser?.(e.userId)}>{e.email ?? e.userId}</button>}
          <span className="ml-reason">
            {e.reason}
            {e.jobId && <span className="muted"> · {e.jobId}</span>}
            {typeof e.meta?.prompt === "string" && e.meta.prompt && <span className="muted"> · «{String(e.meta.prompt).slice(0, 120)}»</span>}
          </span>
        </div>
      ))}
      {!loading && !entries.length && <div className="muted small">Записей нет</div>}
      {cursor && <button className="btn small" disabled={loading} onClick={() => load(cursor)}>{loading ? "Загружаю…" : "Ещё"}</button>}
    </div>
  );
}
