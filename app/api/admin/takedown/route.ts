import { NextResponse } from "next/server";
import { errorResponse } from "@/lib/http";
import { requireCtx } from "@/lib/me";
import { takedown } from "@/lib/moderation";

// { id, indexes?, reason, warn? } — снять генерацию (результаты удаляются, запись уходит в карантин и журнал)
export async function POST(req: Request) {
  try {
    await requireCtx({ admin: true });
    const b = (await req.json()) as { id?: string; indexes?: number[]; reason?: string; warn?: boolean };
    if (!b.id) return NextResponse.json({ error: "Нет id" }, { status: 400 });
    const indexes = Array.isArray(b.indexes) ? b.indexes.filter((n) => Number.isInteger(n) && n >= 0) : undefined;
    const result = await takedown(b.id, { indexes, reason: b.reason ?? "", warn: Boolean(b.warn) });
    return NextResponse.json({ result });
  } catch (e) {
    return errorResponse(e);
  }
}
