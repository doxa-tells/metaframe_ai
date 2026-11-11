import { NextResponse } from "next/server";
import { errorResponse } from "@/lib/http";
import { requireCtx } from "@/lib/me";
import { listJobs } from "@/lib/jobs";
import { validUid } from "@/lib/users";

// Генерации конкретного пользователя (для проверки и снятия)
export async function GET(req: Request) {
  try {
    await requireCtx({ admin: true });
    const u = new URL(req.url);
    const uid = u.searchParams.get("uid") ?? "";
    if (!validUid(uid)) return NextResponse.json({ error: "Некорректный uid" }, { status: 400 });
    const kind = u.searchParams.get("kind") === "video" ? "video" : "image";
    return NextResponse.json(await listJobs(kind, u.searchParams.get("cursor") || undefined, uid));
  } catch (e) {
    return errorResponse(e);
  }
}
