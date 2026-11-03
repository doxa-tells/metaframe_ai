import { NextResponse } from "next/server";
import { randomUUID } from "crypto";
import { listItems, putJSON, readJSON } from "@/lib/storage";
import { errorResponse } from "@/lib/http";

type Graph = { id: string; name: string; nodes: unknown[]; edges: unknown[]; savedAt: number };

// Каждое сохранение — новый файл; список показывает последние версии каждой схемы
export async function GET(req: Request) {
  try {
    const id = new URL(req.url).searchParams.get("id");
    const { items } = await listItems("graphs/", 200);
    const latest = new Map<string, (typeof items)[number]>();
    for (const it of items) {
      const m = /^graphs\/\d{13}_(.+)\.json$/.exec(it.pathname);
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
    const g = (await req.json()) as Partial<Graph>;
    const id = g.id && /^[a-z0-9-]{4,40}$/.test(g.id) ? g.id : randomUUID().slice(0, 12);
    const inv = String(9_999_999_999_999 - Date.now()).padStart(13, "0");
    const graph: Graph = { id, name: (g.name || "Без названия").slice(0, 80), nodes: g.nodes ?? [], edges: g.edges ?? [], savedAt: Date.now() };
    await putJSON(`graphs/${inv}_${id}.json`, graph);
    return NextResponse.json({ id });
  } catch (e) {
    return errorResponse(e);
  }
}
