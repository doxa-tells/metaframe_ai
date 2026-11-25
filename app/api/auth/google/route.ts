import { NextResponse } from "next/server";
import { randomBytes } from "crypto";
import { BASE } from "@/lib/base";
import { appUrl } from "@/lib/mail";
import { OAUTH_COOKIE, googleOn } from "@/lib/authflow";
import { shortCookie } from "@/lib/session";

// Начало входа через Google: отправляем человека на страницу Google. state защищает от подмены ответа:
// то же значение лежит в cookie браузера и должно вернуться в адресе
export async function GET() {
  if (!googleOn()) return NextResponse.redirect(`${appUrl()}/login?err=google_off`);
  const state = randomBytes(24).toString("hex");
  const q = new URLSearchParams({
    client_id: process.env.GOOGLE_CLIENT_ID!.trim(),
    redirect_uri: `${appUrl()}/api/auth/google/callback`,
    response_type: "code",
    scope: "openid email profile",
    state,
    prompt: "select_account",
  });
  const res = NextResponse.redirect(`https://accounts.google.com/o/oauth2/v2/auth?${q}`);
  res.cookies.set(OAUTH_COOKIE, state, { ...shortCookie(10), path: BASE });
  return res;
}
