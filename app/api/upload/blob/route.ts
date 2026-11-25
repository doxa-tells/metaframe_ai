import { NextResponse } from "next/server";
import { handleUpload, type HandleUploadBody } from "@vercel/blob/client";
import { requireCtx } from "@/lib/me";

// Прямая загрузка из браузера в Vercel Blob (обходит лимит 4.5 МБ на тело запроса)
export async function POST(req: Request) {
  try {
    const body = (await req.json()) as HandleUploadBody;
    const json = await handleUpload({
      body,
      request: req,
      onBeforeGenerateToken: async (pathname) => {
        if (!pathname.startsWith("uploads/")) throw new Error("Недопустимый путь");
        await requireCtx({ active: true });
        return {
          allowedContentTypes: ["image/*", "video/*", "audio/*"],
          maximumSizeInBytes: 500 * 1024 * 1024,
          addRandomSuffix: true,
        };
      },
      onUploadCompleted: async () => {},
    });
    return NextResponse.json(json);
  } catch (e) {
    console.error("[upload/blob]", (e as Error).message);
    return NextResponse.json({ error: "Не удалось начать загрузку" }, { status: 400 });
  }
}
