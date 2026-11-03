import "server-only";
import { ProviderError } from "./higgsfield";

// BytePlus ModelArk: https://docs.byteplus.com/en/docs/modelark
// Авторизация: "Authorization: Bearer <ARK_API_KEY>"
const BASE = (process.env.ARK_BASE_URL || "https://ark.ap-southeast.bytepluses.com/api/v3").replace(/\/$/, "");

export function arkKey(): string | null {
  return process.env.ARK_API_KEY?.trim() || null;
}

// Переопределение ID моделей через переменные окружения, если BytePlus их обновит
export function arkModelId(appModelId: string, fallback: string): string {
  const env = "ARK_MODEL_" + appModelId.replace(/[^a-z0-9]/gi, "_").toUpperCase();
  return process.env[env]?.trim() || fallback;
}

async function ark(pathname: string, init: RequestInit = {}): Promise<Record<string, unknown>> {
  const key = arkKey();
  if (!key) throw new ProviderError("Не задан ключ BytePlus ModelArk (ARK_API_KEY)", 400);
  const res = await fetch(`${BASE}/${pathname.replace(/^\//, "")}`, {
    ...init,
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json", ...(init.headers ?? {}) },
    cache: "no-store",
  });
  const text = await res.text();
  let data: Record<string, unknown> = {};
  try { data = text ? JSON.parse(text) : {}; } catch { data = { raw: text }; }
  if (!res.ok) {
    const err = data.error as { code?: string; message?: string } | undefined;
    let msg = err?.message || (data.raw as string)?.slice(0, 300) || res.statusText;
    if (err?.code === "ModelNotOpen") msg = "Модель не активирована в консоли ModelArk (Model activation → Activate)";
    throw new ProviderError(`BytePlus ${res.status}${err?.code ? ` ${err.code}` : ""}: ${msg}`, res.status);
  }
  return data;
}

// ---------- Изображения (Seedream), синхронно ----------
export async function seedreamGenerate(body: Record<string, unknown>): Promise<string[]> {
  const d = await ark("images/generations", { method: "POST", body: JSON.stringify(body) });
  const items = (d.data ?? []) as { url?: string; b64_json?: string; error?: { message?: string } }[];
  const urls = items.map((i) => i.url || (i.b64_json ? `data:image/jpeg;base64,${i.b64_json}` : "")).filter(Boolean);
  if (!urls.length) {
    const reason = items.find((i) => i.error)?.error?.message || "пустой ответ";
    throw new ProviderError(`Seedream не вернул изображение: ${reason}`, 422);
  }
  return urls;
}

// ---------- Видео (Seedance), асинхронные задачи ----------
export async function seedanceSubmit(body: Record<string, unknown>): Promise<string> {
  const d = await ark("contents/generations/tasks", { method: "POST", body: JSON.stringify(body) });
  const id = String(d.id ?? "");
  if (!id) throw new ProviderError("BytePlus не вернул id задачи");
  return id;
}

export type ArkStatus = {
  status: "queued" | "in_progress" | "completed" | "failed" | "canceled";
  videoUrl?: string;
  error?: string;
};

export async function seedanceStatus(taskId: string): Promise<ArkStatus> {
  const d = await ark(`contents/generations/tasks/${encodeURIComponent(taskId)}`);
  const s = String(d.status ?? "queued");
  const content = d.content as { video_url?: string } | undefined;
  const err = d.error as { code?: string; message?: string } | null | undefined;
  const map: Record<string, ArkStatus["status"]> = {
    queued: "queued", running: "in_progress", succeeded: "completed", failed: "failed", expired: "failed", cancelled: "canceled",
  };
  return {
    status: map[s] ?? "in_progress",
    videoUrl: content?.video_url,
    error: err?.message ? `${err.code ? err.code + ": " : ""}${err.message}` : s === "expired" ? "Задача истекла" : undefined,
  };
}

export async function seedanceCancel(taskId: string): Promise<void> {
  await ark(`contents/generations/tasks/${encodeURIComponent(taskId)}`, { method: "DELETE" });
}
