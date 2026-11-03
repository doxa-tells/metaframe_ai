import { NextResponse } from "next/server";
import { signUpload, useWorker } from "@/lib/storage";

// Подписанная ссылка для прямой загрузки референса в R2
export async function POST(req: Request) {
  if (!useWorker) return NextResponse.json({ error: "Хранилище R2 не настроено" }, { status: 400 });
  const { name, contentType } = (await req.json().catch(() => ({}))) as { name?: string; contentType?: string };
  if (!contentType || !/^(image|video|audio)\//.test(contentType)) {
    return NextResponse.json({ error: "Можно загружать только изображения, видео и аудио" }, { status: 400 });
  }
  return NextResponse.json(signUpload(name || "file"));
}
