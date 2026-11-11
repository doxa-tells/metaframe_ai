"use client";
import type { GenRequest, Kind } from "./models";
import { withBase } from "./base";

export type JobStatus = "queued" | "in_progress" | "completed" | "failed" | "nsfw" | "canceled";
export type JobOutput = { url: string; type: "image" | "video"; thumb?: string };
// Лёгкая картинка для сетки (оригинал — для просмотра и скачивания)
export const thumbOf = (o: JobOutput) => (o.thumb && o.thumb !== "-" ? o.thumb : o.url);
export type Job = {
  id: string; kind: Kind; modelId: string; modeId: string; prompt: string;
  params: Record<string, unknown>; inputs: Record<string, string[]>; cost: number;
  provider: string; providerRequestId?: string; status: JobStatus; outputs: JobOutput[];
  error?: string; createdAt: number; finishedAt?: number; userId?: string; ip?: string;
};
export const TERMINAL: JobStatus[] = ["completed", "failed", "nsfw", "canceled"];
export const isTerminal = (s: JobStatus) => TERMINAL.includes(s);

export type AppConfig = {
  mock: boolean;
  storage: "worker" | "blob" | "local";
  storageMissing?: boolean;
  providers: { google: boolean; higgsfield: boolean; byteplus: boolean; anthropic: boolean };
};

async function api<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(withBase(url), {
    ...init,
    headers: init?.body && !(init.body instanceof FormData) ? { "Content-Type": "application/json", ...(init?.headers ?? {}) } : init?.headers,
  });
  if (res.status === 401) {
    window.location.href = withBase("/login");
    throw new Error("Нужен вход");
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((data as { error?: string }).error || `Ошибка ${res.status}`);
  return data as T;
}

export const getConfig = () => api<AppConfig>("/api/config");
export const generate = (req: GenRequest) => api<{ job: Job }>("/api/generate", { method: "POST", body: JSON.stringify(req) }).then((r) => r.job);
export const listJobs = (kind: Kind, cursor?: string) =>
  api<{ jobs: Job[]; cursor?: string }>(`/api/jobs?kind=${kind}${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""}`);
export const pollJob = (job: Job) =>
  api<{ job: Partial<Job> & { id: string; status: JobStatus } }>("/api/jobs/poll", {
    method: "POST", body: JSON.stringify({ id: job.id, providerRequestId: job.providerRequestId }),
  }).then((r) => r.job);
export const cancelJob = (job: Job) => api("/api/jobs/cancel", { method: "POST", body: JSON.stringify({ id: job.id, providerRequestId: job.providerRequestId }) });
export const deleteJob = (id: string) => api(`/api/jobs/${id}`, { method: "DELETE" });
export const bulkDelete = (items: { id: string; indexes?: number[] }[]) =>
  api<{ results: Record<string, string> }>("/api/jobs/bulk-delete", { method: "POST", body: JSON.stringify({ items }) }).then((r) => r.results);

export type SoulId = { id: string; name: string; status: string; thumbnail?: string };
export const listSoulIds = () => api<{ items: SoulId[] }>("/api/soul-ids").then((r) => r.items);
export const createSoulId = (name: string, images: string[]) =>
  api<{ item: SoulId }>("/api/soul-ids", { method: "POST", body: JSON.stringify({ name, images }) }).then((r) => r.item);

export type GraphMeta = { id: string; name: string; savedAt: number };
export const listGraphs = () => api<{ graphs: GraphMeta[] }>("/api/graphs").then((r) => r.graphs);
export const loadGraph = (id: string) =>
  api<{ graph: { id: string; name: string; nodes: unknown[]; edges: unknown[] } | null }>(`/api/graphs?id=${id}`).then((r) => r.graph);
export const saveGraph = (g: { id?: string; name: string; nodes: unknown[]; edges: unknown[] }) =>
  api<{ id: string }>("/api/graphs", { method: "POST", body: JSON.stringify(g) }).then((r) => r.id);

// Загрузка файла: напрямую в Vercel Blob или через сервер в локальном режиме
export async function uploadFile(file: File, storage: "worker" | "blob" | "local"): Promise<string> {
  if (storage === "worker") {
    if (file.size > 95 * 1024 * 1024) throw new Error("Файл больше 95 МБ");
    const { uploadUrl, url } = await api<{ uploadUrl: string; url: string }>("/api/upload/sign", {
      method: "POST", body: JSON.stringify({ name: file.name, contentType: file.type }),
    });
    const r = await fetch(uploadUrl, { method: "PUT", body: file, headers: { "Content-Type": file.type || "application/octet-stream" } });
    if (!r.ok) throw new Error(`Не удалось загрузить файл (${r.status})`);
    return url;
  }
  if (storage === "blob") {
    const { upload } = await import("@vercel/blob/client");
    const safe = file.name.replace(/[^a-zA-Z0-9._-]/g, "_").slice(-60) || "file";
    const res = await upload(`uploads/${safe}`, file, { access: "public", handleUploadUrl: withBase("/api/upload/blob") });
    return res.url;
  }
  const fd = new FormData();
  fd.append("file", file);
  const r = await api<{ url: string }>("/api/upload", { method: "POST", body: fd });
  return r.url;
}

// Ожидание завершения задачи с нарастающим интервалом
export async function waitForJob(job: Job, onUpdate?: (j: Job) => void, signal?: { cancelled: boolean }): Promise<Job> {
  let current = job;
  let delay = 2500;
  while (!isTerminal(current.status) && current.providerRequestId) {
    await new Promise((r) => setTimeout(r, delay));
    if (signal?.cancelled) return current;
    try {
      const upd = await pollJob(current);
      current = { ...current, ...upd } as Job;
      onUpdate?.(current);
    } catch (e) {
      // временные сбои сети — продолжаем
      console.warn(e);
    }
    delay = Math.min(10000, delay * 1.3);
  }
  return current;
}

export function timeAgo(ts: number): string {
  const s = Math.floor((Date.now() - ts) / 1000);
  if (s < 60) return `${s} с назад`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m} мин назад`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h} ч назад`;
  return new Date(ts).toLocaleDateString("ru-RU", { day: "numeric", month: "short" });
}

export const STATUS_LABEL: Record<JobStatus, string> = {
  queued: "В очереди", in_progress: "Генерируется", completed: "Готово", failed: "Ошибка", nsfw: "Модерация", canceled: "Отменено",
};

// Чаты проектов
export type ChatMsg = { role: "user" | "assistant"; content: string; images?: string[] };
export type ChatMeta = { id: string; name: string; count: number; updatedAt: number; hasInstructions: boolean };
export type ChatRecord = { id: string; name: string; instructions: string; messages: ChatMsg[]; createdAt: number; updatedAt: number };
export const listChats = () => api<{ chats: ChatMeta[] }>("/api/chats").then((r) => r.chats);
export const getChat = (id: string) => api<{ chat: ChatRecord | null }>(`/api/chats?id=${id}`).then((r) => r.chat);
export const saveChat = (c: Partial<ChatRecord> & { name: string }) =>
  api<{ chat: ChatRecord }>("/api/chats", { method: "POST", body: JSON.stringify(c) }).then((r) => r.chat);
export const deleteChatApi = (id: string) => api(`/api/chats?id=${id}`, { method: "DELETE" });

// Баланс по провайдерам (ведётся в студии)
export type BalanceRow = { provider: "google" | "byteplus" | "higgsfield"; amount: number | null; since: number | null; spent: number; left: number | null; count: number };
export const getBalances = (fresh = false) => api<{ balances: BalanceRow[] }>(`/api/balance${fresh ? "?fresh=1" : ""}`).then((r) => r.balances);
export const setBalanceApi = (provider: BalanceRow["provider"], amount: number | null) =>
  api<{ balances: BalanceRow[] }>("/api/balance", { method: "POST", body: JSON.stringify({ provider, amount }) }).then((r) => r.balances);

export type Preset = { id: string; name: string; preview_url?: string };
const presetCache = new Map<string, Promise<Preset[]>>();
export function listPresetsApi(path: string): Promise<Preset[]> {
  if (!presetCache.has(path)) {
    const p = api<{ items: Preset[] }>(`/api/presets?path=${encodeURIComponent(path)}`).then((r) => r.items);
    p.catch(() => presetCache.delete(path));
    presetCache.set(path, p);
  }
  return presetCache.get(path)!;
}

export const getFavoritesApi = () => api<{ keys: string[] }>("/api/favorites").then((r) => r.keys);
export const setFavoritesApi = (keys: string[], on: boolean) =>
  api<{ keys: string[] }>("/api/favorites", { method: "POST", body: JSON.stringify({ keys, on }) }).then((r) => r.keys);

export const ensureThumbsApi = (ids: string[]) =>
  api<{ jobs: Job[] }>("/api/jobs/thumbs", { method: "POST", body: JSON.stringify({ ids }) }).then((r) => r.jobs);

// Кэш истории между переходами Фото ↔ Видео: показываем сразу, обновляем в фоне
const jobsCache = new Map<Kind, { jobs: Job[]; cursor?: string }>();
export const cachedJobs = (kind: Kind) => jobsCache.get(kind);
export const rememberJobs = (kind: Kind, jobs: Job[], cursor?: string) => jobsCache.set(kind, { jobs, cursor });

// Заранее проверить референс на модерацию провайдера (Seedance: реальные лица, копирайт)
export type PrecheckResult = { ok: boolean; reason?: string; status?: string; skipped?: boolean; skipReason?: string; retryAfter?: number };
export const precheckApi = (modelId: string, url: string, kind: "image" | "video") =>
  api<PrecheckResult>("/api/precheck", { method: "POST", body: JSON.stringify({ modelId, url, kind }) });
