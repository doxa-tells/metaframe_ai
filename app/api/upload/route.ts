import { NextResponse } from "next/server";
import { randomUUID } from "crypto";
import { putFile } from "@/lib/storage";
import { errorResponse } from "@/lib/http";

// Загрузка через сервер (локальный режим и небольшие файлы). В Blob-режиме клиент грузит напрямую через /api/upload/blob.
export async function POST(req: Request) {
  try {
    const form = await req.formData();
    const file = form.get("file");
    if (!(file instanceof File)) return NextResponse.json({ error: "Нет файла" }, { status: 400 });
    const safe = file.name.replace(/[^a-zA-Z0-9._-]/g, "_").slice(-60) || "file";
    const url = await putFile(`uploads/${randomUUID().slice(0, 12)}-${safe}`, Buffer.from(await file.arrayBuffer()), file.type || "application/octet-stream");
    return NextResponse.json({ url, contentType: file.type });
  } catch (e) {
    return errorResponse(e);
  }
}
