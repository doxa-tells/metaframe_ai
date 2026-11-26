import "server-only";
import { ProviderError } from "./higgsfield";
import { describeNetError, isNetworkError, withRetry } from "../net";

// Gemini API: Nano Banana 2.1 (generateContent) и текстовая модель для чата.
const BASE = (process.env.GEMINI_BASE_URL || "https://generativelanguage.googleapis.com/v1beta").replace(/\/$/, "");
export const NANO_MODEL = process.env.NANO_BANANA_MODEL || "gemini-nano-banana-2.1";
// ID моделей Gemini для картинок по модели студии (переопределяются переменными окружения, если Google их обновит)
const NANO_IDS: Record<string, string> = {
  "nano-banana-2.1": NANO_MODEL,
  "nano-banana-2-lite": process.env.NANO_BANANA_LITE_MODEL || "gemini-3.1-flash-lite-image",
  "nano-banana-pro": process.env.NANO_BANANA_PRO_MODEL || "gemini-3-pro-image",
};
export const nanoModelId = (appModelId: string): string => NANO_IDS[appModelId] ?? NANO_MODEL;
export const GEMINI_CHAT_MODEL = process.env.GEMINI_CHAT_MODEL || "gemini-flash-latest";

export function googleKey(): string | null {
  return process.env.GEMINI_API_KEY?.trim() || process.env.GOOGLE_API_KEY?.trim() || null;
}

// Реф скачивается в память и уходит провайдеру как base64 — поэтому с потолком размера:
// без него одна ссылка на огромный файл роняла копию функции вместе с чужими генерациями
export const INLINE_IMAGE_MAX = 40 * 1048576;
export const INLINE_VIDEO_MAX = 120 * 1048576;
export async function fetchAsInline(url: string, maxBytes = INLINE_IMAGE_MAX): Promise<{ mimeType: string; data: string }> {
  const r = await withRetry(() => fetch(url, { cache: "no-store", signal: AbortSignal.timeout(60_000) })).catch((e) => { throw describeNetError(e, "хранилищем (референс)"); });
  if (!r.ok || !r.body) throw new ProviderError(`Не удалось загрузить референс (${r.status})`, 400);
  const tooBig = () => new ProviderError(`Референс больше ${Math.round(maxBytes / 1048576)} МБ — уменьшите файл`, 413);
  if (Number(r.headers.get("content-length") || 0) > maxBytes) { await r.body.cancel().catch(() => {}); throw tooBig(); }
  const mimeType = (r.headers.get("content-type") || "image/png").split(";")[0];
  const reader = r.body.getReader();
  const chunks: Uint8Array[] = [];
  let n = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    n += value.length;
    if (n > maxBytes) { await reader.cancel().catch(() => {}); throw tooBig(); }
    chunks.push(value);
  }
  return { mimeType, data: Buffer.concat(chunks).toString("base64") };
}

export type NanoParams = {
  prompt: string;
  refs: { mimeType: string; data: string }[]; // base64
  aspectRatio?: string;
  imageSize?: string; // нет — размер по умолчанию у модели (1K)
  thinking?: string;
  model?: string;     // ID модели Gemini; по умолчанию Nano Banana 2.1
};

// Один повтор при обрыве связи или ответе без картинки (Gemini иногда отвечает только текстом)
export async function nanoBananaGenerate(p: NanoParams): Promise<{ data: Buffer; mimeType: string }[]> {
  return withRetry(() => nanoBananaOnce(p), {
    tries: 2, baseDelay: 1500,
    retryIf: (e) => isNetworkError(e) || (e as { noImage?: boolean }).noImage === true,
  }).catch((e) => { throw describeNetError(e, "Google Gemini"); });
}

async function nanoBananaOnce(p: NanoParams): Promise<{ data: Buffer; mimeType: string }[]> {
  const key = googleKey();
  if (!key) throw new ProviderError("Не задан ключ Google AI Studio (GEMINI_API_KEY)", 400);
  const parts: Record<string, unknown>[] = [];
  for (const r of p.refs) parts.push({ inlineData: r });
  parts.push({ text: p.prompt });
  const imageConfig: Record<string, string> = {};
  if (p.imageSize) imageConfig.imageSize = p.imageSize;
  if (p.aspectRatio && p.aspectRatio !== "auto") imageConfig.aspectRatio = p.aspectRatio;
  const generationConfig: Record<string, unknown> = { responseModalities: ["IMAGE"] };
  if (Object.keys(imageConfig).length) generationConfig.imageConfig = imageConfig;
  if (p.thinking) generationConfig.thinkingConfig = { thinkingLevel: p.thinking };

  const res = await fetch(`${BASE}/models/${p.model || NANO_MODEL}:generateContent`, {
    method: "POST",
    headers: { "x-goog-api-key": key, "Content-Type": "application/json" },
    body: JSON.stringify({ contents: [{ role: "user", parts }], generationConfig }),
    cache: "no-store",
  });
  const json = (await res.json().catch(() => null)) as Record<string, unknown> | null;
  if (!res.ok) {
    const msg = (json?.error as Record<string, unknown> | undefined)?.message;
    throw new ProviderError(`Gemini ${res.status}: ${msg ?? res.statusText}`, res.status);
  }
  const out: { data: Buffer; mimeType: string }[] = [];
  const candidates = (json?.candidates ?? []) as Record<string, unknown>[];
  for (const c of candidates) {
    const cParts = ((c.content as Record<string, unknown> | undefined)?.parts ?? []) as Record<string, unknown>[];
    for (const part of cParts) {
      const inline = part.inlineData as { data?: string; mimeType?: string } | undefined;
      if (inline?.data && !part.thought) out.push({ data: Buffer.from(inline.data, "base64"), mimeType: inline.mimeType || "image/png" });
    }
  }
  if (!out.length) {
    const finish = candidates[0]?.finishReason as string | undefined;
    const block = (json?.promptFeedback as Record<string, unknown> | undefined)?.blockReason as string | undefined;
    // Что модель написала вместо картинки — чтобы было понятно, почему
    const said = candidates.flatMap((c) => ((c.content as Record<string, unknown> | undefined)?.parts ?? []) as Record<string, unknown>[])
      .filter((x) => typeof x.text === "string" && !x.thought).map((x) => String(x.text)).join(" ").trim().slice(0, 220);
    const reason = block ? `заблокировано (${block})` : finish && finish !== "STOP" ? finish : said ? `модель ответила текстом: «${said}»` : "пустой ответ";
    // Повторять имеет смысл только «пустой» ответ; отказ фильтра повторится и снова будет стоить денег
    const censored = Boolean(block) || /SAFETY|PROHIBITED|BLOCKLIST|SPII|RECITATION/.test(finish ?? "");
    throw Object.assign(new ProviderError(`Gemini не вернул изображение — ${reason}`, 422), { noImage: !censored });
  }
  return out;
}

// ---------- Gemini Omni Flash: видео через Interactions API (в фоне, с опросом) ----------
export const OMNI_MODEL = process.env.GEMINI_OMNI_MODEL || "gemini-omni-1.1-flash";

async function gfetch(path: string, init: RequestInit = {}): Promise<Record<string, unknown>> {
  const key = googleKey();
  if (!key) throw new ProviderError("Не задан ключ Google AI Studio (GEMINI_API_KEY)", 400);
  const res = await withRetry(() => fetch(`${BASE}/${path}`, {
    ...init,
    headers: { "x-goog-api-key": key, "Content-Type": "application/json", ...(init.headers ?? {}) },
    cache: "no-store",
  })).catch((e) => { throw describeNetError(e, "Google Gemini"); });
  const json = (await res.json().catch(() => null)) as Record<string, unknown> | null;
  if (!res.ok) {
    const msg = (json?.error as Record<string, unknown> | undefined)?.message;
    throw new ProviderError(`Gemini ${res.status}: ${msg ?? res.statusText}`, res.status);
  }
  return json ?? {};
}

export async function omniSubmit(body: Record<string, unknown>): Promise<string> {
  const d = await gfetch("interactions", { method: "POST", body: JSON.stringify({ model: OMNI_MODEL, ...body, background: true, store: true }) });
  const id = String(d.id ?? "");
  if (!id) throw new ProviderError("Gemini не вернул id задачи");
  return id;
}

export type OmniStatus = {
  status: "in_progress" | "completed" | "failed" | "canceled";
  video?: { data?: string; uri?: string; mimeType: string };
  error?: string;
};

export async function omniStatus(id: string): Promise<OmniStatus> {
  const d = await gfetch(`interactions/${encodeURIComponent(id)}`);
  const raw = String(d.status ?? "in_progress");
  const errs = (d.errors as { message?: string }[] | undefined) ?? [];
  const errText = errs.map((e) => e.message).filter(Boolean).join("; ");
  if (raw === "in_progress") return { status: "in_progress" };
  if (raw === "cancelled") return { status: "canceled", error: "Отменено" };
  const steps = (d.steps as { type?: string; content?: Record<string, unknown>[] }[] | undefined) ?? [];
  const outs = steps.filter((s) => s.type === "model_output").flatMap((s) => s.content ?? []);
  const v = outs.find((c) => c.type === "video");
  if (raw === "completed" && v) {
    return { status: "completed", video: { data: typeof v.data === "string" ? v.data : undefined, uri: typeof v.uri === "string" ? v.uri : undefined, mimeType: String(v.mime_type ?? "video/mp4") } };
  }
  const said = outs.filter((c) => c.type === "text" && typeof c.text === "string").map((c) => c.text as string).join(" ").slice(0, 300);
  return { status: "failed", error: errText || (said ? `Модель не сделала видео: «${said}»` : raw === "completed" ? "Модель не вернула видео" : `Генерация не удалась (${raw})`) };
}

export async function omniDownload(uri: string): Promise<Buffer> {
  const key = googleKey();
  const r = await fetch(uri, { headers: key ? { "x-goog-api-key": key } : {}, redirect: "follow", cache: "no-store" });
  if (!r.ok) throw new ProviderError(`Не удалось скачать видео Gemini (${r.status})`);
  return Buffer.from(await r.arrayBuffer());
}

export async function omniCancel(id: string): Promise<void> {
  await gfetch(`interactions/${encodeURIComponent(id)}/cancel`, { method: "POST", body: "{}" });
}

export async function omniDelete(id: string): Promise<void> {
  await gfetch(`interactions/${encodeURIComponent(id)}`, { method: "DELETE" }).catch(() => {});
}
