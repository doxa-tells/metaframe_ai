import { NextResponse } from "next/server";
import { createJob } from "@/lib/jobs";
import { errorResponse, requestOrigin } from "@/lib/http";
import { clientIp, requireCtx } from "@/lib/me";
import { assertWithinLimit } from "@/lib/moderation";
import { estimateCost, type GenRequest } from "@/lib/models";

export const maxDuration = 300;

export async function POST(req: Request) {
  try {
    const me = await requireCtx({ active: true });
    const body = (await req.json()) as GenRequest;
    // Пользователи тратят деньги владельца — проверяем суточный лимит
    if (me.user) await assertWithinLimit(me.user, estimateCost(body));
    const job = await createJob(body, requestOrigin(req), me.user ? { uid: me.uid, ip: clientIp(req), souls: me.user.souls ?? [] } : {});
    return NextResponse.json({ job });
  } catch (e) {
    return errorResponse(e);
  }
}
