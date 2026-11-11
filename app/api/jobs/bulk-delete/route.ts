import { NextResponse } from "next/server";
import { jobScope, removeOutputs } from "@/lib/jobs";
import { errorResponse } from "@/lib/http";
import { requireCtx } from "@/lib/me";

// Пакетное удаление: [{ id, indexes? }] — без indexes удаляется вся задача
export async function POST(req: Request) {
  try {
    const me = await requireCtx();
    const { items: raw } = (await req.json()) as { items: { id: string; indexes?: number[] }[] };
    if (!Array.isArray(raw) || raw.length > 500) return NextResponse.json({ error: "Некорректный список" }, { status: 400 });
    const results: Record<string, string> = {};
    // Удалять можно только своё
    const items = raw.filter((it) => {
      const ok = typeof it?.id === "string" && jobScope(it.id) === me.scope;
      if (!ok && typeof it?.id === "string") results[it.id] = "error: нет доступа";
      return ok;
    });
    // небольшими порциями, чтобы не упереться в лимиты хранилища
    for (let i = 0; i < items.length; i += 8) {
      await Promise.all(items.slice(i, i + 8).map(async (it) => {
        try { results[it.id] = await removeOutputs(it.id, it.indexes); }
        catch (e) { results[it.id] = `error: ${(e as Error).message}`; }
      }));
    }
    return NextResponse.json({ results });
  } catch (e) {
    return errorResponse(e);
  }
}
