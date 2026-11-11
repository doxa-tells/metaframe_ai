import { NextResponse } from "next/server";
import { deleteJob, jobScope } from "@/lib/jobs";
import { errorResponse } from "@/lib/http";
import { requireCtx } from "@/lib/me";

export async function DELETE(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const me = await requireCtx();
    const { id } = await ctx.params;
    if (jobScope(id) !== me.scope) return NextResponse.json({ error: "Не найдено" }, { status: 404 });
    await deleteJob(id);
    return NextResponse.json({ ok: true });
  } catch (e) {
    return errorResponse(e);
  }
}
