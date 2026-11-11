import { NextResponse } from "next/server";
import { getSoulId } from "@/lib/providers/higgsfield";
import { errorResponse } from "@/lib/http";
import { requireCtx } from "@/lib/me";

export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const me = await requireCtx();
    const { id } = await ctx.params;
    if (!me.admin && !(me.user?.souls ?? []).includes(id)) return NextResponse.json({ error: "Не найдено" }, { status: 404 });
    if (id.startsWith("mock-")) return NextResponse.json({ item: { id, name: "Мой персонаж", status: "completed" } });
    return NextResponse.json({ item: await getSoulId(id) });
  } catch (e) {
    return errorResponse(e);
  }
}
