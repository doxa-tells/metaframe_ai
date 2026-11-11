import { NextResponse } from "next/server";
import { errorResponse } from "@/lib/http";
import { requireCtx } from "@/lib/me";
import { applyAction, limitOf, spentLastDay, type AdminAction } from "@/lib/moderation";
import { getUser, publicUser, validUid } from "@/lib/users";

const ACTIONS: AdminAction[] = ["verify", "reject", "warn", "freeze", "unfreeze", "ban", "unban", "limit", "note", "credit"];

export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    await requireCtx({ admin: true });
    const { id } = await ctx.params;
    const u = validUid(id) ? await getUser(id, true) : null;
    if (!u) return NextResponse.json({ error: "Не найдено" }, { status: 404 });
    return NextResponse.json({ user: publicUser(u), limit: limitOf(u), spent: await spentLastDay(u.id) });
  } catch (e) {
    return errorResponse(e);
  }
}

// { action, reason?, days?, limit? }
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    await requireCtx({ admin: true });
    const { id } = await ctx.params;
    if (!validUid(id)) return NextResponse.json({ error: "Некорректный id" }, { status: 400 });
    const b = (await req.json()) as { action?: AdminAction; reason?: string; days?: number; limit?: number | null; amount?: number };
    if (!b.action || !ACTIONS.includes(b.action)) return NextResponse.json({ error: "Неизвестное действие" }, { status: 400 });
    const u = await applyAction(id, b.action, { reason: b.reason, days: Number(b.days) || undefined, limit: b.limit === null ? null : b.limit === undefined ? undefined : Number(b.limit), amount: Number(b.amount) });
    return NextResponse.json({ user: publicUser(u), limit: limitOf(u) });
  } catch (e) {
    return errorResponse(e);
  }
}
