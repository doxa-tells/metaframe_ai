import { NextResponse } from "next/server";
import { errorResponse, readJsonBody } from "@/lib/http";
import { clientIp } from "@/lib/me";
import { mailOn } from "@/lib/mail";
import { CAPTCHA_ERROR, verifyCaptcha } from "@/lib/captcha";
import { mailResetLink, readResetToken, startSession } from "@/lib/authflow";
import { effectiveStatus, findByEmail, getUser, hashPassword, updateUser } from "@/lib/users";
import { overQuota } from "@/lib/usage";
import { tooMany } from "@/lib/ratelimit";
import { logAction } from "@/lib/modlog";

// Запрос сброса: { email }. Ответ всегда одинаковый — по нему нельзя узнать, есть ли такая почта
export async function POST(req: Request) {
  try {
    if (!mailOn()) return NextResponse.json({ error: "Сброс пароля по почте пока не настроен — напишите владельцу студии" }, { status: 503 });
    const b = await readJsonBody<{ email?: unknown; captcha?: unknown }>(req, 8192);
    const email = typeof b.email === "string" ? b.email.trim().toLowerCase().slice(0, 200) : "";
    const ip = clientIp(req) ?? "?";
    if (!email) return NextResponse.json({ error: "Введите почту" }, { status: 400 });
    if (tooMany(`reset:${ip}`, 10, 60 * 60_000)) return NextResponse.json({ error: "Слишком много запросов — попробуйте через час" }, { status: 429 });
    if (!(await verifyCaptcha(b.captcha, ip))) return NextResponse.json({ error: CAPTCHA_ERROR, captcha: true }, { status: 400 });
    const done = NextResponse.json({ ok: true });
    if (await overQuota(`reset:ip:${ip}`, 10, 3_600_000)) return done;
    if (await overQuota(`reset:email:${email}`, 3, 3_600_000)) return done;
    const user = await findByEmail(email).catch(() => null);
    if (user && effectiveStatus(user) !== "banned") await mailResetLink(user).catch((e) => console.error("[reset-mail]", (e as Error).message));
    return done;
  } catch (e) {
    return errorResponse(e);
  }
}

// Новый пароль по ссылке из письма: { token, password }
export async function PUT(req: Request) {
  try {
    const b = await readJsonBody<{ token?: unknown; password?: unknown }>(req, 8192);
    const password = typeof b.password === "string" ? b.password : "";
    if (password.length < 8 || password.length > 200) return NextResponse.json({ error: "Пароль — не короче 8 символов" }, { status: 400 });
    const t = await readResetToken(b.token);
    const cur = t ? await getUser(t.uid, true) : null;
    const stale = () => NextResponse.json({ error: "Ссылка устарела или уже использована — запросите новую" }, { status: 400 });
    if (!t || !cur || cur.ver !== t.ver) return stale();
    if (effectiveStatus(cur) === "banned") return NextResponse.json({ error: "Аккаунт заблокирован" }, { status: 403 });
    const passHash = await hashPassword(password);
    let used = false;
    const user = await updateUser(cur.id, (u) => {
      if (u.ver !== t.ver) { used = true; return; }
      u.passHash = passHash;
      u.ver = (u.ver ?? 1) + 1; // прежние сессии и эта ссылка перестают работать
      if (!u.emailVerified) u.emailVerified = Date.now(); // ссылка пришла на почту — почта подтверждена
    });
    if (used) return stale();
    await logAction({ actor: "user", action: "password", userId: user.id, email: user.email, meta: { ip: clientIp(req) } }).catch(() => {});
    const res = NextResponse.json({ ok: true });
    await startSession(res, user);
    return res;
  } catch (e) {
    return errorResponse(e);
  }
}
