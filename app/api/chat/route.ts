import { systemPrompt } from "@/lib/chat";
import { googleKey, GEMINI_CHAT_MODEL, fetchAsInline } from "@/lib/providers/google";
import { readLocalFile, toAbsolute } from "@/lib/storage";
import { requestOrigin } from "@/lib/http";

export const maxDuration = 120;

type Msg = { role: "user" | "assistant"; content: string; images?: string[] };
type Body = { messages: Msg[]; modelId?: string; modeId?: string };

const ANTHROPIC_MODEL = process.env.ANTHROPIC_MODEL || "claude-sonnet-5-5";

async function inline(url: string, origin: string) {
  if (url.startsWith("/api/files/")) {
    const buf = await readLocalFile(url.slice("/api/files/".length));
    if (buf) return { mimeType: url.endsWith(".svg") ? "image/svg+xml" : "image/png", data: buf.toString("base64") };
  }
  return fetchAsInline(toAbsolute(url, origin));
}

// Разбор SSE-потока: вызывает onData для каждой строки data:
async function readSSE(res: Response, onData: (json: Record<string, unknown>) => string | null, write: (t: string) => void) {
  const reader = res.body!.getReader();
  const dec = new TextDecoder();
  let buf = "";
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
    let idx;
    while ((idx = buf.indexOf("\n")) >= 0) {
      const line = buf.slice(0, idx).trim();
      buf = buf.slice(idx + 1);
      if (!line.startsWith("data:")) continue;
      const payload = line.slice(5).trim();
      if (!payload || payload === "[DONE]") continue;
      try {
        const t = onData(JSON.parse(payload));
        if (t) write(t);
      } catch { /* неполный JSON — пропускаем */ }
    }
  }
}

export async function POST(req: Request) {
  const body = (await req.json()) as Body;
  const origin = requestOrigin(req);
  const system = systemPrompt(body.modelId, body.modeId);
  const messages = (body.messages ?? []).filter((m) => m.content?.trim() || m.images?.length).slice(-30);
  const enc = new TextEncoder();

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const write = (t: string) => controller.enqueue(enc.encode(t));
      try {
        if (process.env.MOCK_PROVIDERS === "1" && !process.env.ANTHROPIC_API_KEY && !googleKey()) {
          const last = messages[messages.length - 1]?.content ?? "";
          for (const w of `Тестовый режим. Вот вариант промпта:\n\n\`\`\`\nCinematic shot, ${last.slice(0, 120)}, golden hour, 35mm, shallow depth of field\n\`\`\``.split(" ")) {
            write(w + " ");
            await new Promise((r) => setTimeout(r, 15));
          }
        } else if (process.env.ANTHROPIC_API_KEY) {
          const anthMessages = await Promise.all(messages.map(async (m) => {
            if (m.role === "assistant" || !m.images?.length) return { role: m.role, content: m.content || "…" };
            const parts: Record<string, unknown>[] = [];
            for (const u of m.images) {
              const im = await inline(u, origin);
              parts.push({ type: "image", source: { type: "base64", media_type: im.mimeType, data: im.data } });
            }
            parts.push({ type: "text", text: m.content || "Опиши изображение и предложи промпт." });
            return { role: "user", content: parts };
          }));
          const res = await fetch("https://api.anthropic.com/v1/messages", {
            method: "POST",
            headers: {
              "x-api-key": process.env.ANTHROPIC_API_KEY!,
              "anthropic-version": "2023-06-01",
              "content-type": "application/json",
            },
            body: JSON.stringify({ model: ANTHROPIC_MODEL, max_tokens: 2048, system, messages: anthMessages, stream: true }),
          });
          if (!res.ok) throw new Error(`Anthropic ${res.status}: ${(await res.text()).slice(0, 300)}`);
          await readSSE(res, (j) => {
            const d = j.delta as { type?: string; text?: string } | undefined;
            return j.type === "content_block_delta" && d?.type === "text_delta" ? d.text ?? null : null;
          }, write);
        } else if (googleKey()) {
          const contents = await Promise.all(messages.map(async (m) => {
            const parts: Record<string, unknown>[] = [];
            for (const u of m.images ?? []) parts.push({ inlineData: await inline(u, origin) });
            parts.push({ text: m.content || (m.images?.length ? "Опиши изображение и предложи промпт." : "…") });
            return { role: m.role === "assistant" ? "model" : "user", parts };
          }));
          const res = await fetch(
            `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_CHAT_MODEL}:streamGenerateContent?alt=sse`,
            {
              method: "POST",
              headers: { "x-goog-api-key": googleKey()!, "Content-Type": "application/json" },
              body: JSON.stringify({ systemInstruction: { parts: [{ text: system }] }, contents }),
            },
          );
          if (!res.ok) throw new Error(`Gemini ${res.status}: ${(await res.text()).slice(0, 300)}`);
          await readSSE(res, (j) => {
            const c = (j.candidates as Record<string, unknown>[] | undefined)?.[0];
            const parts = ((c?.content as Record<string, unknown> | undefined)?.parts ?? []) as { text?: string; thought?: boolean }[];
            return parts.filter((p) => !p.thought).map((p) => p.text ?? "").join("") || null;
          }, write);
        } else {
          write("Чат не настроен: добавьте GEMINI_API_KEY или ANTHROPIC_API_KEY в переменные окружения.");
        }
      } catch (e) {
        write(`\n\n⚠️ ${(e as Error).message}`);
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, { headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store" } });
}
