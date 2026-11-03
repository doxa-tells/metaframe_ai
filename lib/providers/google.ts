import "server-only";
import { ProviderError } from "./higgsfield";

// Gemini API: Nano Banana 2.1 (generateContent) и текстовая модель для чата.
const BASE = "https://generativelanguage.googleapis.com/v1beta";
export const NANO_MODEL = process.env.NANO_BANANA_MODEL || "gemini-nano-banana-2.1";
export const GEMINI_CHAT_MODEL = process.env.GEMINI_CHAT_MODEL || "gemini-flash-latest";

export function googleKey(): string | null {
  return process.env.GEMINI_API_KEY?.trim() || process.env.GOOGLE_API_KEY?.trim() || null;
}

export async function fetchAsInline(url: string): Promise<{ mimeType: string; data: string }> {
  const r = await fetch(url, { cache: "no-store" });
  if (!r.ok) throw new ProviderError(`Не удалось загрузить референс (${r.status})`, 400);
  const mimeType = (r.headers.get("content-type") || "image/png").split(";")[0];
  const buf = Buffer.from(await r.arrayBuffer());
  return { mimeType, data: buf.toString("base64") };
}

export type NanoParams = {
  prompt: string;
  refs: { mimeType: string; data: string }[]; // base64
  aspectRatio?: string;
  imageSize: string;
  thinking?: string;
};

export async function nanoBananaGenerate(p: NanoParams): Promise<{ data: Buffer; mimeType: string }[]> {
  const key = googleKey();
  if (!key) throw new ProviderError("Не задан ключ Google AI Studio (GEMINI_API_KEY)", 400);
  const parts: Record<string, unknown>[] = [];
  for (const r of p.refs) parts.push({ inlineData: r });
  parts.push({ text: p.prompt });
  const imageConfig: Record<string, string> = { imageSize: p.imageSize };
  if (p.aspectRatio && p.aspectRatio !== "auto") imageConfig.aspectRatio = p.aspectRatio;
  const generationConfig: Record<string, unknown> = { responseModalities: ["IMAGE"], imageConfig };
  if (p.thinking) generationConfig.thinkingConfig = { thinkingLevel: p.thinking };

  const res = await fetch(`${BASE}/models/${NANO_MODEL}:generateContent`, {
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
    const reason = (candidates[0]?.finishReason as string) ||
      ((json?.promptFeedback as Record<string, unknown> | undefined)?.blockReason as string) || "нет изображения в ответе";
    throw new ProviderError(`Gemini не вернул изображение: ${reason}`, 422);
  }
  return out;
}
