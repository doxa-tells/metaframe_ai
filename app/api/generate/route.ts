import { NextResponse } from "next/server";
import { createJob, newJobId } from "@/lib/jobs";
import { errorResponse, requestOrigin } from "@/lib/http";
import { clientIp, requireCtx } from "@/lib/me";
import { chargeCredits, refundCredits } from "@/lib/moderation";
import { getMode, getModel, SRC_DURATION, validateRequest, type GenRequest } from "@/lib/models";
import { creditsFor } from "@/lib/credits";
import { videoSeconds } from "@/lib/mediaprobe";

export const maxDuration = 300;

export async function POST(req: Request) {
  try {
    const me = await requireCtx({ active: true });
    const body = (await req.json()) as GenRequest;
    if (!me.user) return NextResponse.json({ job: await createJob(body, requestOrigin(req)) });

    // Пользователь: кредиты списываются до запуска; не прошёл запуск — возвращаются (по журналу, ровно один раз)
    const bad = validateRequest(body);
    if (bad) return NextResponse.json({ error: bad }, { status: 400 });
    const model = getModel(body.modelId)!;
    const mode = getMode(model, body.modeId);
    // Цена «за секунду исходника» считается по длительности, которую определил сервер, а не браузер
    if (mode.source) {
      const src = body.inputs?.video_url?.[0];
      const sec = src ? await videoSeconds(src, requestOrigin(req)) : null;
      if (sec && mode.source.strict && sec > mode.source.max + 0.5) {
        return NextResponse.json({ error: `Видео длиннее ${mode.source.max} с — обрежьте его` }, { status: 400 });
      }
      body.params = { ...(body.params ?? {}), [SRC_DURATION]: sec ?? mode.source.max };
    }
    const credits = creditsFor(body);
    const id = newJobId(model.kind, me.uid);
    await chargeCredits(me.user, id, credits);
    try {
      const job = await createJob(body, requestOrigin(req), { id, uid: me.uid, ip: clientIp(req), souls: me.user.souls ?? [], credits });
      return NextResponse.json({ job });
    } catch (e) {
      await refundCredits(me.uid, id, credits, "задача не запустилась").catch(() => {});
      throw e;
    }
  } catch (e) {
    return errorResponse(e);
  }
}
