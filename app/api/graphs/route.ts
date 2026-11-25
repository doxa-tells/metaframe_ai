import { NextResponse } from "next/server";
import { randomUUID } from "crypto";
import { listItems, putJSON, readJSON } from "@/lib/storage";
import { errorResponse, readJsonBody } from "@/lib/http";
import { tooMany } from "@/lib/ratelimit";
import { requireCtx } from "@/lib/me";

type Graph = { id: string; name: string; nodes: unknown[]; edges: unknown[]; savedAt: number };

// Каждое сохранение — новый файл; список показывает последние версии каждой схемы.
// У пользователя свои схемы в u/<uid>/graphs/
const dirOf = (scope: string) => (scope ? `u/${scope}/graphs/` : "graphs/");

export async function GET(req: Request) {
  try {
    const { scope } = await requireCtx({ member: true });
    const dir = dirOf(scope);
    const id = new URL(req.url).searchParams.get("id");
    const { items } = await listItems(dir, 200);
    const latest = new Map<string, (typeof items)[number]>();
    for (const it of items) {
      const m = /^\d{13}_(.+)\.json$/.exec(it.pathname.slice(dir.length));
      if (m && !latest.has(m[1])) latest.set(m[1], it);
    }
    if (id) {
      const it = latest.get(id);
      return NextResponse.json({ graph: it ? await readJSON<Graph>(it) : null });
    }
    const graphs = await Promise.all([...latest.values()].slice(0, 50).map((i) => readJSON<Graph>(i)));
    return NextResponse.json({ graphs: graphs.filter(Boolean).map((g) => ({ id: g!.id, name: g!.name, savedAt: g!.savedAt })) });
  } catch (e) {
    return errorResponse(e);
  }
}

export async function POST(req: Request) {
  try {
    const { scope } = await requireCtx({ member: true });
    if (scope && tooMany(`graphs:${scope}`, 60, 60_000)) return NextResponse.json({ error: "Слишком частые сохранения — подождите минуту" }, { status: 429 });
    const g = await readJsonBody<Partial<Graph>>(req, 1_572_864);
    if (!g || typeof g !== "object" || (g.name !== undefined && typeof g.name !== "string") || (g.nodes !== undefined && !Array.isArray(g.nodes)) || (g.edges !== undefined && !Array.isArray(g.edges))) {
      return NextResponse.json({ error: "Некорректная схема" }, { status: 400 });
    }
    if ((g.nodes?.length ?? 0) > 500 || (g.edges?.length ?? 0) > 2000) return NextResponse.json({ error: "Схема слишком большая" }, { status: 400 });
    const id = typeof g.id === "string" && /^[a-z0-9-]{4,40}$/.test(g.id) ? g.id : randomUUID().slice(0, 12);
    const inv = String(9_999_999_999_999 - Date.now()).padStart(13, "0");
    const graph: Graph = { id, name: (g.name || "Без названия").slice(0, 80), nodes: g.nodes ?? [], edges: g.edges ?? [], savedAt: Date.now() };
    await putJSON(`${dirOf(scope)}${inv}_${id}.json`, graph);
    return NextResponse.json({ id });
  } catch (e) {
    return errorResponse(e);
  }
}
