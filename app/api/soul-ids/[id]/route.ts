import { NextResponse } from "next/server";
import { getSoulId } from "@/lib/providers/higgsfield";
import { errorResponse } from "@/lib/http";

export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await ctx.params;
    return NextResponse.json({ item: await getSoulId(id) });
  } catch (e) {
    return errorResponse(e);
  }
}
