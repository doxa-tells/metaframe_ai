import { NextResponse } from "next/server";
import { AUTH_COOKIE, authToken } from "@/lib/auth";

export async function POST(req: Request) {
  const pw = process.env.APP_PASSWORD;
  if (!pw) return NextResponse.json({ error: "На сервере не задан APP_PASSWORD" }, { status: 500 });
  const { password } = (await req.json().catch(() => ({}))) as { password?: string };
  if (!password || password !== pw) {
    await new Promise((r) => setTimeout(r, 600));
    return NextResponse.json({ error: "Неверный пароль" }, { status: 401 });
  }
  const res = NextResponse.json({ ok: true });
  res.cookies.set(AUTH_COOKIE, await authToken(pw), {
    httpOnly: true, secure: process.env.NODE_ENV === "production", sameSite: "lax", path: "/", maxAge: 60 * 60 * 24 * 90,
  });
  return res;
}

export async function DELETE() {
  const res = NextResponse.json({ ok: true });
  res.cookies.delete(AUTH_COOKIE);
  return res;
}
