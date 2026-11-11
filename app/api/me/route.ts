import { NextResponse } from "next/server";
import { errorResponse } from "@/lib/http";
import { requireCtx } from "@/lib/me";
import { limitOf, spentLastDay } from "@/lib/moderation";
import { updateUser } from "@/lib/users";

// Кто я: роль, статус, непрочитанные предупреждения, суточный лимит
export async function GET(req: Request) {
  try {
    const me = await requireCtx();
    if (me.admin) return NextResponse.json({ role: "admin" });
    const u = me.user!;
    const withSpent = new URL(req.url).searchParams.has("spent");
    return NextResponse.json({
      role: "user",
      id: u.id, name: u.name, email: u.email, status: me.status, statusReason: u.statusReason, frozenUntil: u.frozenUntil,
      warnings: (u.warnings ?? []).filter((w) => !w.ack).map(({ id, at, reason }) => ({ id, at, reason })),
      limit: limitOf(u),
      ...(withSpent ? { spent: await spentLastDay(u.id) } : {}),
    });
  } catch (e) {
    return errorResponse(e);
  }
}

// { ack: id предупреждения } — пользователь прочитал предупреждение (время прочтения сохраняется)
export async function POST(req: Request) {
  try {
    const me = await requireCtx();
    if (!me.user) return NextResponse.json({ ok: true });
    const { ack } = (await req.json()) as { ack?: string };
    if (typeof ack !== "string") return NextResponse.json({ error: "Нет id" }, { status: 400 });
    await updateUser(me.uid, (u) => { u.warnings = (u.warnings ?? []).map((w) => (w.id === ack && !w.ack ? { ...w, ack: Date.now() } : w)); });
    return NextResponse.json({ ok: true });
  } catch (e) {
    return errorResponse(e);
  }
}
