import { NextResponse } from "next/server";
import { AUTH_COOKIE, cookieOptions, signSession } from "@/lib/session";
import { CONSENT_VERSION, createUser, findByEmail } from "@/lib/users";
import { logAction } from "@/lib/modlog";
import { clientIp } from "@/lib/me";
import { tooMany } from "@/lib/ratelimit";

type Body = { name?: string; email?: string; phone?: string; country?: string; purpose?: string; password?: string; terms?: boolean; likeness?: boolean };

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

// Регистрация: аккаунт создаётся «на проверке», генерации откроются после подтверждения личности владельцем
export async function POST(req: Request) {
  const b = (await req.json().catch(() => ({}))) as Body;
  const ip = clientIp(req);
  if (tooMany(`reg:${ip ?? "?"}`, 5, 60 * 60_000)) return NextResponse.json({ error: "Слишком много регистраций с этого адреса — попробуйте через час" }, { status: 429 });
  const name = (b.name ?? "").trim().replace(/\s+/g, " ");
  const email = (b.email ?? "").trim();
  const phone = (b.phone ?? "").trim();
  const country = (b.country ?? "").trim();
  const purpose = (b.purpose ?? "").trim();
  const password = b.password ?? "";
  if (name.split(" ").length < 2 || name.length < 5 || name.length > 120) return NextResponse.json({ error: "Укажите фамилию и имя полностью, как в документе" }, { status: 400 });
  if (!EMAIL_RE.test(email) || email.length > 160) return NextResponse.json({ error: "Проверьте почту" }, { status: 400 });
  if (phone.replace(/\D/g, "").length < 10 || phone.length > 30) return NextResponse.json({ error: "Укажите телефон с кодом страны" }, { status: 400 });
  if (country.length < 2 || country.length > 60) return NextResponse.json({ error: "Укажите страну" }, { status: 400 });
  if (password.length < 8 || password.length > 200) return NextResponse.json({ error: "Пароль — не короче 8 символов" }, { status: 400 });
  if (!b.terms || !b.likeness) return NextResponse.json({ error: "Нужно принять правила" }, { status: 400 });
  if (await findByEmail(email)) return NextResponse.json({ error: "Эта почта уже зарегистрирована — войдите" }, { status: 409 });

  const user = await createUser({
    name, email, phone, country, purpose: purpose.slice(0, 500), password,
    createdIp: ip, consent: { version: CONSENT_VERSION, at: Date.now(), ip },
  });
  await logAction({ actor: "user", action: "register", userId: user.id, email: user.email, meta: { ip, consent: CONSENT_VERSION } });
  const res = NextResponse.json({ ok: true, status: user.status });
  res.cookies.set(AUTH_COOKIE, await signSession({ uid: user.id, role: "user", ver: user.ver }), cookieOptions());
  return res;
}
