import { NextResponse } from "next/server";

// Ошибки с явным статусом — наши собственные и ошибки провайдеров: их текст написан для пользователя.
// Остальное (сбой в коде, неожиданный ответ) наружу не отдаём: полный текст остаётся в логах сервера
export function errorResponse(e: unknown) {
  const err = e as { message?: string; status?: number };
  const known = typeof err?.status === "number" && err.status >= 400 && err.status < 600;
  console.error("[api]", err?.message ?? e);
  if (!known) return NextResponse.json({ error: "Ошибка сервера — попробуйте ещё раз" }, { status: 500 });
  return NextResponse.json({ error: err.message || "Ошибка сервера" }, { status: err.status });
}

export function requestOrigin(req: Request): string {
  const h = req.headers;
  const proto = h.get("x-forwarded-proto") ?? "https";
  const host = h.get("x-forwarded-host") ?? h.get("host");
  return host ? `${proto}://${host}` : new URL(req.url).origin;
}

// Тело запроса как JSON с потолком размера (по умолчанию 1 МБ): большие тела не разбираем вовсе
export async function readJsonBody<T>(req: Request, maxBytes = 1_048_576): Promise<T> {
  const tooBig = () => Object.assign(new Error("Слишком большой запрос"), { status: 413 });
  if (Number(req.headers.get("content-length") || 0) > maxBytes) throw tooBig();
  const text = await req.text();
  if (text.length > maxBytes) throw tooBig();
  try { return JSON.parse(text) as T; }
  catch { throw Object.assign(new Error("Некорректный запрос"), { status: 400 }); }
}
