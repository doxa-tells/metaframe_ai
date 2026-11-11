import { NextResponse } from "next/server";
import { cancelJob, jobScope, storedProviderId } from "@/lib/jobs";
import { errorResponse } from "@/lib/http";
import { requireCtx } from "@/lib/me";

export async function POST(req: Request) {
  try {
    const me = await requireCtx();
    const { id, providerRequestId } = (await req.json()) as { id?: string; providerRequestId: string };
    if (!me.admin) {
      if (!id || jobScope(id) !== me.scope || (await storedProviderId(id)) !== providerRequestId) {
        return NextResponse.json({ error: "Не найдено" }, { status: 404 });
      }
    }
    await cancelJob(providerRequestId);
    return NextResponse.json({ ok: true });
  } catch (e) {
    return errorResponse(e);
  }
}
