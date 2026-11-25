import "server-only";
import { createHash, timingSafeEqual } from "crypto";
import type { NextResponse } from "next/server";
import { AUTH_COOKIE, cookieOptions, readToken, signSession, signToken } from "./session";
import { appUrl, mailOn, sendResetMail, sendVerifyMail } from "./mail";
import { usageCount, usageHit } from "./usage";
import type { UserRecord } from "./users";

// Сравнение секретов за постоянное время (по хэшам — длина строки тоже не выдаётся)
export function sameSecret(a: string, b: string): boolean {
  const h = (s: string) => createHash("sha256").update(s).digest();
  return timingSafeEqual(h(a), h(b));
}

export async function startSession(res: NextResponse, user: UserRecord): Promise<void> {
  res.cookies.set(AUTH_COOKIE, await signSession({ uid: user.id, role: "user", ver: user.ver }), cookieOptions());
}
export function endSession(res: NextResponse): void {
  res.cookies.set(AUTH_COOKIE, "", { ...cookieOptions(), maxAge: 0 });
}

// ---------- Неудачные входы: общий счётчик в хранилище (у копий функции память разная) ----------
const WIN = 15 * 60_000;
export const LOGIN_CAPS = { ip: 30, email: 15, captchaAfter: 3 };
export function loginKeys(ip: string, email?: string): string[] {
  return email ? [`loginfail:ip:${ip}`, `loginfail:email:${email.trim().toLowerCase()}`] : [`loginfail:ip:${ip}`];
}
export async function loginFails(keys: string[]): Promise<number[]> {
  const caps = [LOGIN_CAPS.ip, LOGIN_CAPS.email];
  return Promise.all(keys.map((k, i) => usageCount(k, WIN, caps[i]).catch(() => 0)));
}
export const loginFailed = (keys: string[]) => Promise.all(keys.map((k) => usageHit(k, WIN).catch(() => {})));

// ---------- Ссылки из писем ----------
const VERIFY_TTL = 3 * 86_400_000;
const RESET_TTL = 3_600_000;

// Письмо с подтверждением почты. false — письма не настроены или не ушло (регистрацию это не ломает)
export async function mailVerifyLink(user: UserRecord): Promise<boolean> {
  if (!mailOn()) return false;
  try {
    const t = await signToken("verify", { uid: user.id, email: user.email }, VERIFY_TTL);
    await sendVerifyMail(user.email, user.name.split(" ")[1] ?? user.name, `${appUrl()}/api/auth/verify?t=${encodeURIComponent(t)}`);
    return true;
  } catch (e) {
    console.error("[verify-mail]", (e as Error).message);
    return false;
  }
}
export const readVerifyToken = (t: string | null) => readToken<{ uid: string; email: string }>("verify", t);

// Ссылка сброса привязана к версии аккаунта: после смены пароля версия растёт, и ссылка второй раз не сработает
export async function mailResetLink(user: UserRecord): Promise<void> {
  const t = await signToken("reset", { uid: user.id, ver: user.ver }, RESET_TTL);
  await sendResetMail(user.email, `${appUrl()}/reset?t=${encodeURIComponent(t)}`);
}
export const readResetToken = (t: unknown) => readToken<{ uid: string; ver: number }>("reset", typeof t === "string" ? t : null);

// ---------- Вход через Google: незавершённая регистрация ----------
export const SIGNUP_COOKIE = "mf_signup";
export const OAUTH_COOKIE = "mf_oauth";
export type GoogleSignup = { email: string; name: string; sub: string };
export const signSignup = (d: GoogleSignup) => signToken("gsignup", d, 30 * 60_000);
export const readSignup = (t: string | undefined | null) => readToken<GoogleSignup>("gsignup", t);
export const googleOn = () => Boolean((process.env.GOOGLE_CLIENT_ID || "").trim() && (process.env.GOOGLE_CLIENT_SECRET || "").trim());
