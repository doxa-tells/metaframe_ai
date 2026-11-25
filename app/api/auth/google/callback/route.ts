import { NextResponse, type NextRequest } from "next/server";
import { appUrl } from "@/lib/mail";
import { OAUTH_COOKIE, SIGNUP_COOKIE, googleOn, signSignup, startSession } from "@/lib/authflow";
import { sameStr, shortCookie } from "@/lib/session";
import { effectiveStatus, findByEmail, updateUser } from "@/lib/users";
import { clientIp } from "@/lib/me";
import { tooMany } from "@/lib/ratelimit";
import { logAction } from "@/lib/modlog";

type IdToken = { iss?: string; aud?: string; exp?: number; sub?: string; email?: string; email_verified?: boolean | string; name?: string };

function decodeIdToken(jwt: string): IdToken | null {
  try {
    const part = jwt.split(".")[1];
    return JSON.parse(Buffer.from(part.replace(/-/g, "+").replace(/_/g, "/"), "base64").toString("utf8")) as IdToken;
  } catch { return null; }
}

// Возврат от Google: меняем код на токен, узнаём подтверждённую почту.
// Есть аккаунт с этой почтой — входим; нет — человек дозаполняет ФИО, телефон и согласия (и попадает «на проверку»)
export async function GET(req: NextRequest) {
  const back = (code: string) => {
    const res = NextResponse.redirect(`${appUrl()}/login?err=${code}`);
    res.cookies.set(OAUTH_COOKIE, "", { ...shortCookie(0), maxAge: 0 });
    return res;
  };
  if (!googleOn()) return back("google_off");
  const ip = clientIp(req) ?? "?";
  if (tooMany(`glogin:${ip}`, 30, 15 * 60_000)) return back("google_fail");
  const u = req.nextUrl;
  const state = u.searchParams.get("state") ?? "";
  const saved = req.cookies.get(OAUTH_COOKIE)?.value ?? "";
  const code = u.searchParams.get("code") ?? "";
  if (u.searchParams.get("error")) return back("google_denied");
  if (!code || !state || !saved || !sameStr(state, saved)) return back("google_fail");

  let claims: IdToken | null = null;
  try {
    const r = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST", cache: "no-store", signal: AbortSignal.timeout(15_000),
      body: new URLSearchParams({
        code, grant_type: "authorization_code",
        client_id: process.env.GOOGLE_CLIENT_ID!.trim(), client_secret: process.env.GOOGLE_CLIENT_SECRET!.trim(),
        redirect_uri: `${appUrl()}/api/auth/google/callback`,
      }),
    });
    const d = (await r.json().catch(() => null)) as { id_token?: string } | null;
    // Токен получен напрямую от Google по TLS в обмен на наш секрет — подпись отдельно не проверяем, сверяем адресата и срок
    claims = r.ok && d?.id_token ? decodeIdToken(d.id_token) : null;
  } catch { claims = null; }
  const okIss = claims?.iss === "https://accounts.google.com" || claims?.iss === "accounts.google.com";
  const verified = claims?.email_verified === true || claims?.email_verified === "true";
  if (!claims || !okIss || claims.aud !== process.env.GOOGLE_CLIENT_ID!.trim() || !claims.exp || claims.exp * 1000 < Date.now() || !claims.sub || !claims.email || !verified) {
    return back("google_fail");
  }

  const email = claims.email.trim().toLowerCase();
  const user = await findByEmail(email).catch(() => null);
  if (!user) {
    // Новая почта: аккаунт создаётся после того, как человек заполнит заявку (см. /api/register, google: true)
    const res = NextResponse.redirect(`${appUrl()}/login?google=new`);
    res.cookies.set(SIGNUP_COOKIE, await signSignup({ email, name: (claims.name ?? "").slice(0, 120), sub: claims.sub }), shortCookie(30));
    res.cookies.set(OAUTH_COOKIE, "", { ...shortCookie(0), maxAge: 0 });
    return res;
  }
  if (effectiveStatus(user) === "banned") {
    await logAction({ actor: "user", action: "login_blocked", userId: user.id, email: user.email, meta: { ip, via: "google" } }).catch(() => {});
    return back("banned");
  }
  // Google подтвердил, что почта принадлежит этому человеку
  await updateUser(user.id, (x) => {
    x.lastLoginAt = Date.now(); x.lastIp = ip; x.googleSub ??= claims!.sub;
    if (!x.emailVerified) x.emailVerified = Date.now();
  }).catch(() => {});
  const res = NextResponse.redirect(`${appUrl()}/image`);
  await startSession(res, user);
  res.cookies.set(OAUTH_COOKIE, "", { ...shortCookie(0), maxAge: 0 });
  return res;
}
