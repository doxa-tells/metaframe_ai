import { NextResponse } from "next/server";
import { deleteJob } from "@/lib/jobs";
import { errorResponse } from "@/lib/http";

export async function DELETE(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await ctx.params;
    await deleteJob(id);
    return NextResponse.json({ ok: true });
  } catch (e) {
    return errorResponse(e);
  }
}
