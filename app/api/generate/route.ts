import { NextResponse } from "next/server";
import { createJob, laneOf, newJobId, releaseSlot, reserveSlot } from "@/lib/jobs";
import { errorResponse, readJsonBody, requestOrigin } from "@/lib/http";
import { requireCtx } from "@/lib/me";
import { chargeCredits, ensurePlan, refundCredits } from "@/lib/moderation";
import { getMode, getModel, normalizeRequest, REF_VIDEO_SEC, SRC_DURATION, validateRequest, type GenRequest } from "@/lib/models";
import { creditsFor } from "@/lib/credits";
import { videoSeconds } from "@/lib/mediaprobe";
import { isOwnMediaUrl, OWN_MEDIA_ERROR } from "@/lib/storage";
import { PLAN_NAMES, concurrencyOf } from "@/lib/plans";

export const maxDuration = 300;

export async function POST(req: Request) {
  try {
    const me = await requireCtx({ active: true });
    const raw = await readJsonBody<GenRequest>(req, 262_144);
    if (!me.user) return NextResponse.json({ job: await createJob(raw, requestOrigin(req)) });

    // Пользователь. Запрос приводится к доверенному виду (параметры по умолчанию, типы), и только по нему считается цена
    const norm = normalizeRequest(raw);
    if (!norm.ok) return NextResponse.json({ error: norm.error }, { status: 400 });
    const body = norm.req;
    const bad = validateRequest(body);
    if (bad) return NextResponse.json({ error: bad }, { status: 400 });
    const model = getModel(body.modelId)!;
    const mode = getMode(model, body.modeId);
    // Цена «за секунду исходника» считается по длительности, которую определил сервер, а не браузер
    if (mode.source) {
      const src = body.inputs.video_url?.[0];
      if (src && !isOwnMediaUrl(src)) return NextResponse.json({ error: OWN_MEDIA_ERROR }, { status: 400 });
      const sec = src ? await videoSeconds(src, requestOrigin(req)) : null;
      if (sec && mode.source.strict && sec > mode.source.max + 0.5) {
        return NextResponse.json({ error: `Видео длиннее ${mode.source.max} с — обрежьте его` }, { status: 400 });
      }
      body.params = { ...body.params, [SRC_DURATION]: sec ?? mode.source.max };
    }
    // Seedance у BytePlus: секунды видео-референсов тоже оплачиваются — считаем их на сервере, браузеру не верим.
    // Длину не удалось определить — берём предел одного референса (30 с): лучше списать с запасом, чем работать в минус
    const refVideos = model.provider === "byteplus" && model.kind === "video" ? (body.inputs.video_urls ?? []).filter(Boolean) : [];
    const { [REF_VIDEO_SEC]: _client, ...cleanParams } = body.params;
    body.params = cleanParams;
    if (refVideos.length) {
      if (refVideos.some((u) => !isOwnMediaUrl(u))) return NextResponse.json({ error: OWN_MEDIA_ERROR }, { status: 400 });
      const secs = await Promise.all(refVideos.map((u) => videoSeconds(u, requestOrigin(req)).catch(() => null)));
      body.params = { ...body.params, [REF_VIDEO_SEC]: Math.ceil(secs.reduce<number>((a, x) => a + (x && x > 0 ? x : 30), 0) * 10) / 10 };
    }
    const credits = creditsFor(body);
    if (!(credits > 0)) return NextResponse.json({ error: "Не удалось рассчитать стоимость генерации — обновите страницу и попробуйте ещё раз" }, { status: 400 });

    // Порядок: слот (лимит одновременных генераций по пакету) → кредиты → запуск. Что-то не прошло — всё откатывается
    const plan = await ensurePlan(me.user);
    const id = newJobId(model.kind, me.uid);
    const active = await reserveSlot(id, laneOf(model), concurrencyOf(plan, model.kind), PLAN_NAMES[plan]);
    try {
      await chargeCredits(me.user, id, credits, plan);
    } catch (e) {
      await releaseSlot(id).catch(() => {});
      throw e;
    }
    try {
      const job = await createJob(body, requestOrigin(req), { id, uid: me.uid, souls: me.user.souls ?? [], credits, active });
      return NextResponse.json({ job });
    } catch (e) {
      await refundCredits(me.uid, id, credits, "задача не запустилась").catch(() => {});
      await releaseSlot(id).catch(() => {});
      throw e;
    }
  } catch (e) {
    return errorResponse(e);
  }
}
