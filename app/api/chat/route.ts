import { googleKey, GEMINI_CHAT_MODEL, fetchAsInline } from "@/lib/providers/google";
import { isOwnMediaUrl, localKeyOf, OWN_MEDIA_ERROR, readLocalFile, toAbsolute } from "@/lib/storage";
import { tooMany } from "@/lib/ratelimit";
import { RATE } from "@/lib/plans";
import { errorResponse, readJsonBody, requestOrigin } from "@/lib/http";
import { requireCtx } from "@/lib/me";
import { LIMITS, overQuota, quotaError } from "@/lib/usage";

export const maxDuration = 120;

type Msg = { role: "user" | "assistant"; content: string; images?: string[] };
type Body = { messages: Msg[]; system?: string };

const ANTHROPIC_MODEL = process.env.ANTHROPIC_MODEL || "claude-sonnet-5-5";

async function inline(url: string, origin: string) {
  const lk = localKeyOf(url);
  if (lk) {
    const buf = await readLocalFile(lk);
    if (buf) return { mimeType: url.endsWith(".svg") ? "image/svg+xml" : "image/png", data: buf.toString("base64") };
  }
  return fetchAsInline(toAbsolute(url, origin), 20 * 1048576);
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
  let body: Body;
  try {
    const me = await requireCtx({ active: true });
    // Чат с ИИ бесплатный для пользователя, поэтому ограничен: размер запроса, частота, число сообщений в сутки.
    // Сначала дешёвые проверки (размер и форма), потом счётчик — отклонённый запрос попытку не тратит
    body = await readJsonBody<Body>(req, 2_097_152);
    if (!Array.isArray(body?.messages) || (body.system !== undefined && typeof body.system !== "string")) throw Object.assign(new Error("Некорректный запрос"), { status: 400 });
    let chars = (body.system ?? "").length;
    for (const m of body.messages) {
      if (!m || (m.role !== "user" && m.role !== "assistant") || (m.content !== undefined && typeof m.content !== "string")) throw Object.assign(new Error("Некорректный запрос"), { status: 400 });
      chars += (m.content ?? "").length;
      if (m.images !== undefined) {
        if (!Array.isArray(m.images) || m.images.length > RATE.chatMaxImages) throw Object.assign(new Error(`Не больше ${RATE.chatMaxImages} картинок в одном сообщении`), { status: 400 });
        // Картинки сервер скачивает сам — только файлы из хранилища студии
        if (me.user && m.images.some((u) => !isOwnMediaUrl(u))) throw Object.assign(new Error(OWN_MEDIA_ERROR), { status: 400 });
      }
    }
    if (me.user && chars > RATE.chatMaxChars) throw Object.assign(new Error("Чат стал слишком длинным для одного запроса — начните новый чат или сократите инструкции"), { status: 413 });
    if (me.user) {
      if (tooMany(`chat:${me.uid}`, RATE.chatPerMin, 60_000)) throw quotaError(`Не больше ${RATE.chatPerMin} сообщений ассистенту в минуту — подождите немного`);
      if (LIMITS.chatPerDay() > 0 && (await overQuota(`chat:${me.uid}`, LIMITS.chatPerDay(), 86_400_000))) {
        throw quotaError(`Лимит ассистента — ${LIMITS.chatPerDay()} сообщений в сутки. Продолжите завтра`);
      }
    }
  } catch (e) { return errorResponse(e); }
  const origin = requestOrigin(req);
  // Без правил по умолчанию: системный промпт — только инструкции проекта, если они есть
  const system = (body.system ?? "").trim();
  const all = body.messages.filter((m) => m.content?.trim() || m.images?.length).slice(-60);
  // Картинки отправляем только из последних 4 сообщений с картинками, в остальных — пометка
  let withImages = 0;
  const messages = [...all].reverse().map((m) => {
    if (!m.images?.length) return m;
    if (withImages++ < 4) return m;
    return { ...m, images: undefined, content: `${m.content}\n[${m.images.length} изобр. ранее в чате]`.trim() };
  }).reverse();
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
            parts.push({ type: "text", text: m.content || "Что на изображении?" });
            return { role: "user", content: parts };
          }));
          const res = await fetch("https://api.anthropic.com/v1/messages", {
            method: "POST",
            headers: {
              "x-api-key": process.env.ANTHROPIC_API_KEY!,
              "anthropic-version": "2023-06-01",
              "content-type": "application/json",
            },
            body: JSON.stringify({ model: ANTHROPIC_MODEL, max_tokens: 4096, ...(system ? { system } : {}), messages: anthMessages, stream: true }),
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
            parts.push({ text: m.content || (m.images?.length ? "Что на изображении?" : "…") });
            return { role: m.role === "assistant" ? "model" : "user", parts };
          }));
          const res = await fetch(
            `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_CHAT_MODEL}:streamGenerateContent?alt=sse`,
            {
              method: "POST",
              headers: { "x-goog-api-key": googleKey()!, "Content-Type": "application/json" },
              body: JSON.stringify({ ...(system ? { systemInstruction: { parts: [{ text: system }] } } : {}), contents }),
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
        console.error("[chat]", (e as Error).message);
        const st = (e as { status?: number }).status;
        write(`\n\n⚠️ ${st && st >= 400 && st < 500 ? (e as Error).message : "Ассистент сейчас недоступен — попробуйте ещё раз через минуту"}`);
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, { headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store" } });
}
