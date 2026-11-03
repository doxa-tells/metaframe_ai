import { NextResponse, type NextRequest } from "next/server";
import { AUTH_COOKIE, isValidToken } from "./lib/auth";

// Всё приложение закрыто паролем APP_PASSWORD, кроме страницы входа
export async function proxy(req: NextRequest) {
  const { pathname } = req.nextUrl;
  if (pathname === "/login" || pathname === "/api/login") return NextResponse.next();
  // Колбэк Vercel Blob о завершении загрузки подписан самим Blob
  if (pathname === "/api/upload/blob" && req.headers.get("x-vercel-signature")) return NextResponse.next();
  const ok = await isValidToken(req.cookies.get(AUTH_COOKIE)?.value);
  if (ok) return NextResponse.next();
  if (pathname.startsWith("/api/")) {
    return NextResponse.json({ error: "Нужен вход" }, { status: 401 });
  }
  const url = req.nextUrl.clone();
  url.pathname = "/login";
  url.search = "";
  return NextResponse.redirect(url);
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|mock.mp4).*)"],
};
