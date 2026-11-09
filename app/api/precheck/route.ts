import { NextResponse } from "next/server";
import { precheckDiagnostics, precheckSeedance } from "@/lib/precheck";
import { errorResponse, requestOrigin } from "@/lib/http";

export const maxDuration = 60;

// Проверка референса заранее (сейчас — для Seedance: реальные лица и копирайт)
// Открыть в браузере /studio/api/precheck — покажет, видны ли ключи BytePlus и работает ли библиотека ассетов
export async function GET() {
  try {
    return NextResponse.json(await precheckDiagnostics());
  } catch (e) {
    return errorResponse(e);
  }
}

export async function POST(req: Request) {
  try {
    const { modelId, url, kind } = (await req.json()) as { modelId?: string; url?: string; kind?: string };
    if (!modelId || !url || (kind !== "image" && kind !== "video")) return NextResponse.json({ error: "Нужны modelId, url и kind" }, { status: 400 });
    return NextResponse.json(await precheckSeedance(modelId, url, kind, requestOrigin(req)));
  } catch (e) {
    console.error("precheck failed:", (e as Error).message);
    return errorResponse(e);
  }
}
