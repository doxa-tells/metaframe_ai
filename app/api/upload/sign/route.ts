import { NextResponse } from "next/server";
import { signUpload, useWorker } from "@/lib/storage";
import { requireCtx } from "@/lib/me";
import { errorResponse } from "@/lib/http";
import { LIMITS, overQuota, quotaError } from "@/lib/usage";

const MAX_UPLOAD = (Number(process.env.MAX_UPLOAD_MB) || 100) * 1048576;

// Подписанная ссылка для прямой загрузки референса в R2
export async function POST(req: Request) {
  let size = 0;
  let body: { name?: string; contentType?: string; size?: number } = {};
  try {
    const me = await requireCtx({ active: true });
    body = (await req.json().catch(() => ({}))) as typeof body;
    size = Number(body.size) || 0;
    if (me.user) {
      if (size > MAX_UPLOAD) return NextResponse.json({ error: `Файл больше ${Math.round(MAX_UPLOAD / 1048576)} МБ` }, { status: 413 });
      if (await overQuota(`upload:${me.uid}`, LIMITS.uploadsPerDay(), 86_400_000)) throw quotaError("Слишком много загрузок за сутки");
    }
  } catch (e) { return errorResponse(e); }
  if (!useWorker) return NextResponse.json({ error: "Хранилище R2 не настроено" }, { status: 400 });
  const { name, contentType } = body;
  if (!contentType || !/^(image|video|audio)\//.test(contentType)) {
    return NextResponse.json({ error: "Можно загружать только изображения, видео и аудио" }, { status: 400 });
  }
  return NextResponse.json(signUpload(name || "file", MAX_UPLOAD));
}
