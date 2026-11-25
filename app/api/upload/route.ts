import { NextResponse } from "next/server";
import { randomUUID } from "crypto";
import { putFile } from "@/lib/storage";
import { errorResponse } from "@/lib/http";
import { requireCtx } from "@/lib/me";
import { LIMITS, overQuota, quotaError } from "@/lib/usage";
import { tooMany } from "@/lib/ratelimit";
import { RATE } from "@/lib/plans";
import { hasCredits } from "@/lib/users";

// Суточный лимит загрузок: у аккаунта без кредитов он меньше
const uploadCap = (u: Parameters<typeof hasCredits>[0]) => (hasCredits(u) ? LIMITS.uploadsPerDay() : LIMITS.uploadsPerDayFree());

// Загрузка через сервер (локальный режим и небольшие файлы). В Blob-режиме клиент грузит напрямую через /api/upload/blob.
export async function POST(req: Request) {
  try {
    const me = await requireCtx({ active: true });
    const len = Number(req.headers.get("content-length") || 0);
    if (len > 60 * 1048576) return NextResponse.json({ error: "Файл больше 60 МБ" }, { status: 413 });
    if (me.user && tooMany(`upload:${me.uid}`, RATE.uploadsPerMin, 60_000)) throw quotaError(`Не больше ${RATE.uploadsPerMin} загрузок в минуту — подождите немного`);
    if (me.user && (await overQuota(`upload:${me.uid}`, uploadCap(me.user), 86_400_000))) throw quotaError(hasCredits(me.user) ? "Слишком много загрузок за сутки" : "Лимит загрузок без кредитов на балансе исчерпан — пополните баланс на странице «Кредиты»");
    const form = await req.formData();
    const file = form.get("file");
    if (!(file instanceof File)) return NextResponse.json({ error: "Нет файла" }, { status: 400 });
    if (!/^(image|video|audio)\//.test(file.type)) return NextResponse.json({ error: "Можно загружать только изображения, видео и аудио" }, { status: 400 });
    const safe = file.name.replace(/[^a-zA-Z0-9._-]/g, "_").slice(-60) || "file";
    const url = await putFile(`uploads/${randomUUID().slice(0, 12)}-${safe}`, Buffer.from(await file.arrayBuffer()), file.type || "application/octet-stream");
    return NextResponse.json({ url, contentType: file.type });
  } catch (e) {
    return errorResponse(e);
  }
}
