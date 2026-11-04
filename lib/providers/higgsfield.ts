import "server-only";

// Higgsfield API: https://docs.higgsfield.ai
// Авторизация: "Authorization: Key <key_id>:<key_secret>" — ключ из консоли вставляется целиком.

const BASE = process.env.HF_API_BASE_URL || "https://api.higgsfield.ai";

export function higgsfieldKey(): string | null {
  const full = process.env.HF_API_KEY?.trim();
  if (full) return full.replace(/^Key\s+/i, "");
  const id = process.env.HF_API_KEY_ID?.trim();
  const secret = process.env.HF_API_KEY_SECRET?.trim();
  if (id && secret) return `${id}:${secret}`;
  return null;
}

export class ProviderError extends Error {
  constructor(message: string, public status = 500) { super(message); }
}

async function hf(pathname: string, init: RequestInit = {}): Promise<unknown> {
  const key = higgsfieldKey();
  if (!key) throw new ProviderError("Не задан ключ Higgsfield API (HF_API_KEY)", 400);
  const res = await fetch(`${BASE}/${pathname.replace(/^\//, "")}`, {
    ...init,
    headers: {
      Authorization: `Key ${key}`,
      "Content-Type": "application/json",
      ...(init.headers ?? {}),
    },
    cache: "no-store",
  });
  const text = await res.text();
  let data: unknown = null;
  try { data = text ? JSON.parse(text) : null; } catch { data = text; }
  if (!res.ok) {
    throw new ProviderError(`Higgsfield ${res.status}: ${extractError(data) || res.statusText}`, res.status);
  }
  return data;
}

function extractError(data: unknown): string {
  if (!data) return "";
  if (typeof data === "string") return data.slice(0, 400);
  const d = data as Record<string, unknown>;
  const detail = d.detail ?? d.message ?? d.error;
  if (typeof detail === "string") return detail;
  if (Array.isArray(detail)) {
    return detail.map((x) => {
      const o = x as Record<string, unknown>;
      const loc = Array.isArray(o.loc) ? o.loc.join(".") : "";
      return `${loc ? loc + ": " : ""}${o.msg ?? JSON.stringify(o)}`;
    }).join("; ");
  }
  return JSON.stringify(data).slice(0, 400);
}

export type HfSubmit = { request_id: string; status: string };

export async function submit(endpoint: string, body: Record<string, unknown>, idempotencyKey: string): Promise<HfSubmit> {
  const data = (await hf(endpoint, {
    method: "POST",
    body: JSON.stringify(body),
    headers: { "Idempotency-Key": idempotencyKey },
  })) as Record<string, unknown>;
  const id = String(data.request_id ?? data.id ?? "");
  if (!id) throw new ProviderError("Higgsfield не вернул request_id");
  return { request_id: id, status: String(data.status ?? "queued") };
}

export type HfStatus = {
  status: "queued" | "in_progress" | "completed" | "failed" | "nsfw" | "canceled";
  outputs: { url: string; type: "image" | "video" }[];
  error?: string;
};

export async function getStatus(requestId: string): Promise<HfStatus> {
  const d = (await hf(`requests/${encodeURIComponent(requestId)}/status`)) as Record<string, unknown>;
  const status = String(d.status ?? "queued") as HfStatus["status"];
  const outputs: HfStatus["outputs"] = [];
  const images = d.images as { url?: string }[] | undefined;
  if (Array.isArray(images)) for (const i of images) if (i?.url) outputs.push({ url: i.url, type: "image" });
  const video = d.video as { url?: string } | undefined;
  if (video?.url) outputs.push({ url: video.url, type: "video" });
  const videos = d.videos as { url?: string }[] | undefined;
  if (Array.isArray(videos)) for (const v of videos) if (v?.url) outputs.push({ url: v.url, type: "video" });
  const err = d.error ?? d.message ?? d.detail;
  return { status, outputs, error: typeof err === "string" ? err : undefined };
}

export async function cancel(requestId: string): Promise<void> {
  await hf(`requests/${encodeURIComponent(requestId)}/cancel`, { method: "POST" });
}

// ---------- Soul ID (custom references) ----------
export type SoulId = { id: string; name: string; status: string; thumbnail?: string };

function normalizeSoul(x: Record<string, unknown>): SoulId {
  const thumb = x.thumbnail_url ?? x.preview_url ?? x.cover_url ??
    (Array.isArray(x.input_images) ? (x.input_images[0] as Record<string, unknown>)?.image_url : undefined);
  return {
    id: String(x.id ?? ""),
    name: String(x.name ?? "Без имени"),
    status: String(x.status ?? "unknown"),
    thumbnail: typeof thumb === "string" ? thumb : undefined,
  };
}

export async function listSoulIds(): Promise<SoulId[]> {
  const d = (await hf("v1/custom-references/list?page=1&page_size=100")) as unknown;
  const o = d as Record<string, unknown>;
  const arr = Array.isArray(d) ? d : (o.items ?? o.data ?? o.results ?? o.custom_references ?? []) as unknown[];
  return (arr as Record<string, unknown>[]).map(normalizeSoul).filter((s) => s.id);
}

export async function createSoulId(name: string, imageUrls: string[]): Promise<SoulId> {
  const d = (await hf("v1/custom-references", {
    method: "POST",
    body: JSON.stringify({
      name,
      model_version: "v2",
      input_images: imageUrls.map((u) => ({ type: "image_url", image_url: u })),
    }),
  })) as Record<string, unknown>;
  return normalizeSoul(d);
}

export async function getSoulId(id: string): Promise<SoulId> {
  const d = (await hf(`v1/custom-references/${encodeURIComponent(id)}`)) as Record<string, unknown>;
  return normalizeSoul(d);
}

// ---------- Каталог стилей (Genjutsu Restyle и др.) ----------
export type HfPreset = { id: string; name: string; preview_url?: string };
export async function listPresets(path: string): Promise<HfPreset[]> {
  const d = (await hf(path)) as Record<string, unknown>;
  const items = (Array.isArray(d) ? d : d.items ?? []) as Record<string, unknown>[];
  return items.map((x) => ({ id: String(x.id ?? ""), name: String(x.name ?? "Стиль"), preview_url: typeof x.preview_url === "string" ? x.preview_url : undefined })).filter((x) => x.id);
}
