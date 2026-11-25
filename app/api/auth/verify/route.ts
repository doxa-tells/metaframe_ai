import { NextResponse, type NextRequest } from "next/server";
import { appUrl, mailOn } from "@/lib/mail";
import { mailVerifyLink, readVerifyToken } from "@/lib/authflow";
import { getUser, updateUserApproving } from "@/lib/users";
import { errorResponse } from "@/lib/http";
import { requireCtx } from "@/lib/me";
import { overQuota } from "@/lib/usage";

// Ссылка из письма: подтверждает почту, открывает аккаунт и ведёт в студию (или на вход)
export async function GET(req: NextRequest) {
  const t = await readVerifyToken(req.nextUrl.searchParams.get("t"));
  const user = t ? await getUser(t.uid, true).catch(() => null) : null;
  if (!t || !user || user.email !== t.email) return NextResponse.redirect(`${appUrl()}/login?err=verify_bad`);
  if (!user.emailVerified || user.status === "pending") await updateUserApproving(user.id, (u) => { if (!u.emailVerified) u.emailVerified = Date.now(); }).catch(() => {});
  return NextResponse.redirect(`${appUrl()}/login?ok=verified`);
}

// Отправить письмо ещё раз (с экрана «Подтвердите почту»)
export async function POST() {
  try {
    const me = await requireCtx();
    if (!me.user) return NextResponse.json({ ok: true });
    if (me.user.emailVerified !== false) return NextResponse.json({ ok: true, verified: true });
    if (!mailOn()) return NextResponse.json({ error: "Отправка писем не настроена" }, { status: 503 });
    if (await overQuota(`verify-mail:${me.uid}`, 3, 3_600_000)) return NextResponse.json({ error: "Письмо уже отправлено — проверьте почту и папку «Спам». Повторить можно через час" }, { status: 429 });
    if (!(await mailVerifyLink(me.user))) return NextResponse.json({ error: "Не удалось отправить письмо — попробуйте позже" }, { status: 502 });
    return NextResponse.json({ ok: true });
  } catch (e) {
    return errorResponse(e);
  }
}
