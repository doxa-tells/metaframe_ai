import { NextResponse } from "next/server";
import { AUTH_COOKIE, cookieOptions, signSession } from "@/lib/session";
import { checkPassword, effectiveStatus, findByEmail, updateUser } from "@/lib/users";
import { logAction } from "@/lib/modlog";
import { clientIp } from "@/lib/me";
import { tooMany } from "@/lib/ratelimit";
import { readJsonBody } from "@/lib/http";
import { CAPTCHA_ERROR, captchaOn, verifyCaptcha } from "@/lib/captcha";
import { LOGIN_CAPS, endSession, loginFailed, loginFails, loginKeys, sameSecret, startSession } from "@/lib/authflow";

const pause = () => new Promise((r) => setTimeout(r, 600));

// Вход: только пароль — владелец (APP_PASSWORD); почта + пароль — пользователь
export async function POST(req: Request) {
  const pw = process.env.APP_PASSWORD;
  if (!pw) return NextResponse.json({ error: "На сервере не задан APP_PASSWORD" }, { status: 500 });
  const b = await readJsonBody<{ email?: unknown; password?: unknown; captcha?: unknown }>(req, 8192).catch(() => ({} as { email?: unknown; password?: unknown; captcha?: unknown }));
  const email = typeof b.email === "string" ? b.email.trim().slice(0, 200) : "";
  const password = typeof b.password === "string" ? b.password : "";
  const ip = clientIp(req) ?? "?";
  if (tooMany(`login:${ip}`, 60, 15 * 60_000)) return NextResponse.json({ error: "Слишком много попыток — подождите 15 минут" }, { status: 429 });
  if (!password || password.length > 200) return NextResponse.json({ error: "Введите пароль" }, { status: 400 });

  // Неудачные попытки считаются в хранилище — общий счётчик для всех копий функции
  const keys = loginKeys(ip, email || undefined);
  const fails = await loginFails(keys);
  if (fails[0] >= LOGIN_CAPS.ip || (fails[1] ?? 0) >= LOGIN_CAPS.email) return NextResponse.json({ error: "Слишком много неудачных попыток — подождите 15 минут" }, { status: 429 });
  // После нескольких промахов — капча: перебор перестаёт быть автоматическим
  const needCaptcha = captchaOn() && fails.some((n) => n >= LOGIN_CAPS.captchaAfter);
  if (needCaptcha && !(await verifyCaptcha(b.captcha, ip))) return NextResponse.json({ error: CAPTCHA_ERROR, captcha: true }, { status: 401 });
  const deny = async (error: string) => {
    await loginFailed(keys);
    await pause();
    return NextResponse.json({ error, captcha: captchaOn() && fails.some((n) => n + 1 >= LOGIN_CAPS.captchaAfter) }, { status: 401 });
  };

  if (!email) {
    if (!sameSecret(password, pw)) return deny("Неверный пароль");
    const res = NextResponse.json({ ok: true, role: "admin" });
    res.cookies.set(AUTH_COOKIE, await signSession({ uid: "", role: "admin", ver: 0 }, 30), cookieOptions(30));
    return res;
  }

  const user = await findByEmail(email);
  // У аккаунта без пароля (вход через Google) хэша нет — проверка честно возвращает «нет»
  if (!user || !(await checkPassword(password, user.passHash))) return deny("Неверная почта или пароль");
  if (effectiveStatus(user) === "banned") {
    await logAction({ actor: "user", action: "login_blocked", userId: user.id, email: user.email, meta: { ip } }).catch(() => {});
    return NextResponse.json({ error: `Аккаунт заблокирован${user.statusReason ? `: ${user.statusReason}` : ""}` }, { status: 403 });
  }
  await updateUser(user.id, (u) => { u.lastLoginAt = Date.now(); u.lastIp = ip; }).catch(() => {});
  const res = NextResponse.json({ ok: true, role: "user", status: effectiveStatus(user) });
  await startSession(res, user);
  return res;
}

export async function DELETE() {
  const res = NextResponse.json({ ok: true });
  endSession(res);
  return res;
}
