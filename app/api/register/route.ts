import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { CONSENT_VERSION, createUser, findByEmail } from "@/lib/users";
import { logAction } from "@/lib/modlog";
import { clientIp } from "@/lib/me";
import { tooMany } from "@/lib/ratelimit";
import { overQuota } from "@/lib/usage";
import { errorResponse, readJsonBody } from "@/lib/http";
import { CAPTCHA_ERROR, verifyCaptcha } from "@/lib/captcha";
import { mailOn } from "@/lib/mail";
import { SIGNUP_COOKIE, mailVerifyLink, readSignup, startSession } from "@/lib/authflow";
import { shortCookie } from "@/lib/session";

type Body = { name?: unknown; email?: unknown; phone?: unknown; country?: unknown; purpose?: unknown; password?: unknown; terms?: unknown; likeness?: unknown; google?: unknown; captcha?: unknown };

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const str = (v: unknown) => (typeof v === "string" ? v : "");
const envNum = (name: string, def: number) => { const n = Number(process.env[name]); return Number.isFinite(n) && n > 0 ? n : def; };

// Регистрация: аккаунт открывается после подтверждения почты по ссылке из письма (lib/users: autoApprove).
// google: true — завершение входа через Google: почта уже подтверждена Google и берётся из подписанного cookie, пароль не нужен,
// аккаунт открыт сразу
export async function POST(req: Request) {
  try {
    const b = await readJsonBody<Body>(req, 16_384);
    const ip = clientIp(req);
    if (tooMany(`reg:${ip ?? "?"}`, 10, 60 * 60_000)) return NextResponse.json({ error: "Слишком много регистраций с этого адреса — попробуйте через час" }, { status: 429 });

    const jar = await cookies();
    const g = b.google ? await readSignup(jar.get(SIGNUP_COOKIE)?.value) : null;
    if (b.google && !g) return NextResponse.json({ error: "Вход через Google устарел — нажмите «Войти с Google» ещё раз" }, { status: 400 });

    const name = str(b.name).trim().replace(/\s+/g, " ");
    const email = g ? g.email : str(b.email).trim();
    const phone = str(b.phone).trim();
    const country = str(b.country).trim();
    const purpose = str(b.purpose).trim();
    const password = str(b.password);
    if (name.split(" ").length < 2 || name.length < 5 || name.length > 120) return NextResponse.json({ error: "Укажите фамилию и имя полностью, как в документе" }, { status: 400 });
    if (!EMAIL_RE.test(email) || email.length > 160) return NextResponse.json({ error: "Проверьте почту" }, { status: 400 });
    if (phone.replace(/\D/g, "").length < 10 || phone.length > 30) return NextResponse.json({ error: "Укажите телефон с кодом страны" }, { status: 400 });
    if (country.length < 2 || country.length > 60) return NextResponse.json({ error: "Укажите страну" }, { status: 400 });
    if (!g && (password.length < 8 || password.length > 200)) return NextResponse.json({ error: "Пароль — не короче 8 символов" }, { status: 400 });
    if (b.terms !== true || b.likeness !== true) return NextResponse.json({ error: "Нужно принять правила" }, { status: 400 });
    // Капча — для обычной регистрации; через Google человек уже прошёл проверку у Google
    if (!g && !(await verifyCaptcha(b.captcha, ip))) return NextResponse.json({ error: CAPTCHA_ERROR, captcha: true }, { status: 400 });
    // Счётчики в хранилище — общие для всех копий функции: с одного адреса и всего по сервису
    if (await overQuota(`reg:ip:${ip ?? "?"}`, envNum("REG_PER_IP_HOURLY", 5), 3_600_000)) return NextResponse.json({ error: "Слишком много регистраций с этого адреса — попробуйте через час" }, { status: 429 });
    if (await overQuota("reg:all", envNum("REG_TOTAL_HOURLY", 100), 3_600_000)) return NextResponse.json({ error: "Сейчас слишком много регистраций — попробуйте через час" }, { status: 429 });
    if (await findByEmail(email)) return NextResponse.json({ error: "Эта почта уже зарегистрирована — войдите" }, { status: 409 });

    const user = await createUser({
      name, email, phone, country, purpose: purpose.slice(0, 500), ...(g ? { googleSub: g.sub } : { password }),
      // Через Google почта уже подтверждена; при обычной регистрации — письмо со ссылкой (если письма настроены)
      ...(g ? { emailVerified: Date.now() } : mailOn() ? { emailVerified: false as const } : {}),
      createdIp: ip, lastIp: ip, consent: { version: CONSENT_VERSION, at: Date.now(), ip },
    });
    await logAction({ actor: "user", action: "register", userId: user.id, email: user.email, meta: { ip, consent: CONSENT_VERSION, via: g ? "google" : "password", ...(user.status === "active" ? { opened: "auto" } : {}) } });
    const mailed = !g && (await mailVerifyLink(user));
    const res = NextResponse.json({ ok: true, status: user.status, mailed });
    await startSession(res, user);
    if (g) res.cookies.set(SIGNUP_COOKIE, "", { ...shortCookie(0), maxAge: 0 });
    return res;
  } catch (e) {
    return errorResponse(e);
  }
}
