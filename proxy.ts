import { NextResponse, type NextRequest } from "next/server";
import { AUTH_COOKIE, readSession } from "./lib/session";

const PUBLIC = new Set(["/login", "/api/login", "/api/register", "/terms"]);

// Всё приложение закрыто входом (владелец — APP_PASSWORD, пользователи — почта и пароль), кроме входа и правил.
// Здесь проверяется только подпись cookie; статус аккаунта (бан, заморозка) проверяют API и страницы.
export async function proxy(req: NextRequest) {
  const { pathname } = req.nextUrl;
  if (PUBLIC.has(pathname)) return NextResponse.next();
  // Колбэк Vercel Blob о завершении загрузки подписан самим Blob
  if (pathname === "/api/upload/blob" && req.headers.get("x-vercel-signature")) return NextResponse.next();
  const ok = Boolean(await readSession(req.cookies.get(AUTH_COOKIE)?.value));
  if (ok) return NextResponse.next();
  if (pathname.startsWith("/api/")) {
    return NextResponse.json({ error: "Нужен вход" }, { status: 401 });
  }
  // Показываем вход прямо по этому адресу (без перенаправления) — так пользователь
  // остаётся на metaframe.ltd/studio, даже когда студия открыта через лендинг
  const url = req.nextUrl.clone();
  url.pathname = "/login";
  url.search = "";
  return NextResponse.rewrite(url);
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|icon.png|apple-icon.png|logo.png|mock.mp4|assets/).*)"],
};
