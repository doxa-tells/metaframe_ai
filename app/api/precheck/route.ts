import { NextResponse } from "next/server";
import { precheckDiagnostics, precheckSeedance } from "@/lib/precheck";
import { errorResponse, readJsonBody, requestOrigin } from "@/lib/http";
import { isOwnMediaUrl, OWN_MEDIA_ERROR } from "@/lib/storage";
import { requireCtx } from "@/lib/me";

export const maxDuration = 60;

// Проверка референса заранее (сейчас — для Seedance: реальные лица и копирайт)
// Открыть в браузере /studio/api/precheck — покажет, видны ли ключи BytePlus и работает ли библиотека ассетов
export async function GET() {
  try {
    await requireCtx({ admin: true });
    return NextResponse.json(await precheckDiagnostics());
  } catch (e) {
    return errorResponse(e);
  }
}

export async function POST(req: Request) {
  try {
    const me = await requireCtx({ active: true });
    const { modelId, url, kind } = await readJsonBody<{ modelId?: string; url?: string; kind?: string }>(req, 8192);
    if (typeof modelId !== "string" || typeof url !== "string" || !modelId || !url || (kind !== "image" && kind !== "video")) return NextResponse.json({ error: "Нужны modelId, url и kind" }, { status: 400 });
    // BytePlus скачивает реф по этой ссылке от нашего имени — только файлы из хранилища студии
    if (me.user && !isOwnMediaUrl(url)) return NextResponse.json({ error: OWN_MEDIA_ERROR }, { status: 400 });
    return NextResponse.json(await precheckSeedance(modelId, url, kind, requestOrigin(req), me.scope));
  } catch (e) {
    console.error("precheck failed:", (e as Error).message);
    return errorResponse(e);
  }
}
