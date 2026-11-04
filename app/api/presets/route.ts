import { NextResponse } from "next/server";
import { listPresets, type HfPreset } from "@/lib/providers/higgsfield";
import { MOCK } from "@/lib/jobs";
import { errorResponse } from "@/lib/http";
import { MODELS } from "@/lib/models";
import { withBase } from "@/lib/base";

// Разрешаем только каталоги, объявленные в реестре моделей
const ALLOWED = new Set(MODELS.flatMap((m) => m.modes.flatMap((x) => x.params.flatMap((p) => (p.type === "preset" ? [p.presets] : [])))));
const cache = new Map<string, { at: number; items: HfPreset[] }>();

export async function GET(req: Request) {
  try {
    const path = new URL(req.url).searchParams.get("path") ?? "";
    if (!ALLOWED.has(path)) return NextResponse.json({ error: "Неизвестный каталог" }, { status: 400 });
    if (MOCK) {
      const names = ["Аниме", "Пластилин", "Комикс", "Масло", "Пиксель-арт", "Неон"];
      return NextResponse.json({ items: names.map((name, i) => ({ id: `00000000-0000-4000-8000-00000000000${i}`, name, preview_url: withBase("/assets/hero-kling.webp") })) });
    }
    const hit = cache.get(path);
    if (hit && Date.now() - hit.at < 10 * 60_000) return NextResponse.json({ items: hit.items });
    const items = await listPresets(path);
    cache.set(path, { at: Date.now(), items });
    return NextResponse.json({ items });
  } catch (e) {
    return errorResponse(e);
  }
}
