import { NextResponse } from "next/server";
import { getFavorites, setFavorites } from "@/lib/favorites";
import { errorResponse } from "@/lib/http";
import { requireCtx } from "@/lib/me";
import { jobScope } from "@/lib/jobs";

export async function GET() {
  try {
    const ctx = await requireCtx();
    return NextResponse.json({ keys: await getFavorites(ctx.scope) });
  } catch (e) {
    return errorResponse(e);
  }
}

export async function POST(req: Request) {
  try {
    const ctx = await requireCtx();
    const { keys, on } = (await req.json()) as { keys?: unknown; on?: unknown };
    const list = Array.isArray(keys) ? keys.filter((k): k is string => typeof k === "string" && /^[\w.-]+:\d+$/.test(k) && jobScope(k.split(":")[0]) === ctx.scope).slice(0, 500) : [];
    if (!list.length) return NextResponse.json({ error: "Нет ключей" }, { status: 400 });
    return NextResponse.json({ keys: await setFavorites(list, Boolean(on), ctx.scope) });
  } catch (e) {
    return errorResponse(e);
  }
}
