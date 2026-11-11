import { NextResponse } from "next/server";
import { errorResponse } from "@/lib/http";
import { requireCtx } from "@/lib/me";
import { limitOf, spentLastDay } from "@/lib/moderation";
import { updateUser } from "@/lib/users";
import { logAction } from "@/lib/modlog";
import { getPackage } from "@/lib/packages";

// Кто я: роль, статус, кредиты, непрочитанные предупреждения, суточный лимит
export async function GET(req: Request) {
  try {
    const me = await requireCtx();
    if (me.admin) return NextResponse.json({ role: "admin" });
    const u = me.user!;
    const withSpent = new URL(req.url).searchParams.has("spent");
    return NextResponse.json({
      role: "user",
      id: u.id, name: u.name, email: u.email, status: me.status, statusReason: u.statusReason, frozenUntil: u.frozenUntil,
      credits: u.credits ?? 0, payClaim: u.payClaim ?? null,
      warnings: (u.warnings ?? []).filter((w) => !w.ack).map(({ id, at, reason }) => ({ id, at, reason })),
      limit: limitOf(u),
      ...(withSpent ? { spent: await spentLastDay(u.id) } : {}),
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
    const { ack, claim } = (await req.json()) as { ack?: string; claim?: string };
    if (typeof claim === "string") {
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
