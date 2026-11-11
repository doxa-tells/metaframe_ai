import { NextResponse } from "next/server";
import { AUTH_COOKIE, cookieOptions, signSession } from "@/lib/session";
import { checkPassword, effectiveStatus, findByEmail, updateUser } from "@/lib/users";
import { logAction } from "@/lib/modlog";
import { clientIp } from "@/lib/me";
import { tooMany } from "@/lib/ratelimit";

const pause = () => new Promise((r) => setTimeout(r, 600));

// Вход: только пароль — владелец (APP_PASSWORD); почта + пароль — пользователь
export async function POST(req: Request) {
  const pw = process.env.APP_PASSWORD;
  if (!pw) return NextResponse.json({ error: "На сервере не задан APP_PASSWORD" }, { status: 500 });
  const { email, password } = (await req.json().catch(() => ({}))) as { email?: string; password?: string };
  const ip = clientIp(req) ?? "?";
  if (tooMany(`login:${ip}`, 20, 15 * 60_000)) return NextResponse.json({ error: "Слишком много попыток — подождите 15 минут" }, { status: 429 });
  if (!password) return NextResponse.json({ error: "Введите пароль" }, { status: 400 });

  if (!email?.trim()) {
    if (password !== pw) { await pause(); return NextResponse.json({ error: "Неверный пароль" }, { status: 401 }); }
    const res = NextResponse.json({ ok: true, role: "admin" });
    res.cookies.set(AUTH_COOKIE, await signSession({ uid: "", role: "admin", ver: 0 }, 90), cookieOptions(90));
    return res;
  }

  const user = await findByEmail(email);
  if (!user || !(await checkPassword(password, user.passHash))) {
    await pause();
    return NextResponse.json({ error: "Неверная почта или пароль" }, { status: 401 });
  }
  if (effectiveStatus(user) === "banned") {
    await logAction({ actor: "user", action: "login_blocked", userId: user.id, email: user.email, meta: { ip } }).catch(() => {});
    return NextResponse.json({ error: `Аккаунт заблокирован${user.statusReason ? `: ${user.statusReason}` : ""}` }, { status: 403 });
  }
  await updateUser(user.id, (u) => { u.lastLoginAt = Date.now(); u.lastIp = ip; }).catch(() => {});
  const res = NextResponse.json({ ok: true, role: "user", status: effectiveStatus(user) });
  res.cookies.set(AUTH_COOKIE, await signSession({ uid: user.id, role: "user", ver: user.ver }), cookieOptions());
  return res;
}

export async function DELETE() {
  const res = NextResponse.json({ ok: true });
  res.cookies.delete(AUTH_COOKIE);
  return res;
}
