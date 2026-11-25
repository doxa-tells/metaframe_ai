import { NextResponse, after } from "next/server";
import { errorResponse } from "@/lib/http";
import { requireCtx } from "@/lib/me";
import { creditSummary } from "@/lib/moderation";
import { sweepPending } from "@/lib/jobs";
import { updateUser } from "@/lib/users";
import { logAction } from "@/lib/modlog";
import { getPackage } from "@/lib/packages";
import { readJsonBody } from "@/lib/http";
import { tooMany } from "@/lib/ratelimit";
import { PLAN_LIMITS, PLAN_NAMES } from "@/lib/plans";

// Кто я: роль, статус, кредиты, непрочитанные предупреждения, суточный лимит
export async function GET(req: Request) {
  try {
    const me = await requireCtx();
    after(() => sweepPending().catch((e) => console.error("sweep:", (e as Error).message)));
    if (me.admin) return NextResponse.json({ role: "admin" });
    const u = me.user!;
    const withSpent = new URL(req.url).searchParams.has("spent");
    const cs = await creditSummary(u);
    return NextResponse.json({
      role: "user",
      id: u.id, name: u.name, email: u.email, status: me.status, statusReason: u.statusReason, frozenUntil: u.frozenUntil,
      credits: cs.balance, payClaim: u.payClaim ?? null,
      emailVerified: u.emailVerified !== false,
      plan: cs.plan, planName: PLAN_NAMES[cs.plan], concurrency: { video: PLAN_LIMITS[cs.plan].video, image: PLAN_LIMITS[cs.plan].image },
      warnings: (u.warnings ?? []).filter((w) => !w.ack).map(({ id, at, reason }) => ({ id, at, reason })),
      limit: u.creditLimit ?? PLAN_LIMITS[cs.plan].dailyCredits,
      ...(withSpent ? { spent: cs.dayCharged } : {}),
    });
  } catch (e) {
    return errorResponse(e);
  }
}

// { ack: id предупреждения } — прочитал предупреждение; { claim: id пакета } — «оплатил, отправляю чек»
export async function POST(req: Request) {
  try {
    const me = await requireCtx();
    if (!me.user) return NextResponse.json({ ok: true });
    const { ack, claim } = await readJsonBody<{ ack?: string; claim?: string }>(req, 4096);
    if (typeof claim === "string") {
      // Заявка на оплату — только у подтверждённого аккаунта и не чаще нескольких раз в час (каждая пишется в журнал)
      if (me.status !== "active" && me.status !== "frozen") return NextResponse.json({ error: "Аккаунт ещё на проверке" }, { status: 403 });
      if (tooMany(`claim:${me.uid}`, 5, 3_600_000)) return NextResponse.json({ error: "Заявка уже отправлена — дождитесь начисления" }, { status: 429 });
      const pkg = getPackage(claim);
      if (!pkg) return NextResponse.json({ error: "Нет такого пакета" }, { status: 400 });
      const payClaim = { pkg: pkg.id, credits: pkg.credits, price: pkg.price, at: Date.now() };
      await updateUser(me.uid, (u) => { u.payClaim = payClaim; });
      await logAction({ actor: "user", action: "payment_claim", userId: me.uid, email: me.user.email, reason: `Пакет ${pkg.name}: ${pkg.credits} кредитов за ${pkg.price} ₸ (Kaspi)` });
      return NextResponse.json({ ok: true, payClaim });
    }
    if (typeof ack !== "string") return NextResponse.json({ error: "Нет id" }, { status: 400 });
    await updateUser(me.uid, (u) => { u.warnings = (u.warnings ?? []).map((w) => (w.id === ack && !w.ack ? { ...w, ack: Date.now() } : w)); });
    return NextResponse.json({ ok: true });
  } catch (e) {
    return errorResponse(e);
  }
}
