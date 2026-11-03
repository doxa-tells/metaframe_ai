import { NextResponse } from "next/server";
import { listSoulIds, createSoulId } from "@/lib/providers/higgsfield";
import { MOCK } from "@/lib/jobs";
import { errorResponse, requestOrigin } from "@/lib/http";
import { toAbsolute } from "@/lib/storage";

export async function GET() {
  try {
    if (MOCK) return NextResponse.json({ items: [{ id: "mock-soul", name: "Тестовый персонаж", status: "completed" }] });
    return NextResponse.json({ items: await listSoulIds() });
  } catch (e) {
    return errorResponse(e);
  }
}

export async function POST(req: Request) {
  try {
    const { name, images } = (await req.json()) as { name: string; images: string[] };
    if (!name?.trim()) return NextResponse.json({ error: "Укажите имя" }, { status: 400 });
    if (!images?.length) return NextResponse.json({ error: "Добавьте фото" }, { status: 400 });
    if (images.length > 100) return NextResponse.json({ error: "Максимум 100 фото" }, { status: 400 });
    if (MOCK) return NextResponse.json({ item: { id: `mock-${Date.now()}`, name, status: "in_progress" } });
    const origin = requestOrigin(req);
    return NextResponse.json({ item: await createSoulId(name.trim(), images.map((u) => toAbsolute(u, origin))) });
  } catch (e) {
    return errorResponse(e);
  }
}
