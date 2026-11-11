import { NextResponse } from "next/server";
import { createJob } from "@/lib/jobs";
import { errorResponse, requestOrigin } from "@/lib/http";
import { clientIp, requireCtx } from "@/lib/me";
import { assertWithinLimit, chargeCredits, refundCredits } from "@/lib/moderation";
import { estimateCost, validateRequest, type GenRequest } from "@/lib/models";
import { creditsFor } from "@/lib/credits";

export const maxDuration = 300;

export async function POST(req: Request) {
  try {
    const me = await requireCtx({ active: true });
    const body = (await req.json()) as GenRequest;
    if (!me.user) return NextResponse.json({ job: await createJob(body, requestOrigin(req)) });

    // Пользователь: кредиты списываются до запуска; не прошёл суточный лимит или запуск — возвращаются
    const bad = validateRequest(body);
    if (bad) return NextResponse.json({ error: bad }, { status: 400 });
    const credits = creditsFor(body);
    await chargeCredits(me.uid, credits);
    try {
      await assertWithinLimit(me.user, estimateCost(body));
      const job = await createJob(body, requestOrigin(req), { uid: me.uid, ip: clientIp(req), souls: me.user.souls ?? [], credits });
      return NextResponse.json({ job });
    } catch (e) {
      await refundCredits(me.uid, credits).catch(() => {}); // задача не запустилась — кредиты назад
      throw e;
    }
  } catch (e) {
    return errorResponse(e);
  }
}
