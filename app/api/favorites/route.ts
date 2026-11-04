import { NextResponse } from "next/server";
import { getFavorites, setFavorites } from "@/lib/favorites";
import { errorResponse } from "@/lib/http";

export async function GET() {
  try {
    return NextResponse.json({ keys: await getFavorites() });
  } catch (e) {
    return errorResponse(e);
  }
}

export async function POST(req: Request) {
  try {
    const { keys, on } = (await req.json()) as { keys?: unknown; on?: unknown };
    const list = Array.isArray(keys) ? keys.filter((k): k is string => typeof k === "string" && /^[\w.-]+:\d+$/.test(k)).slice(0, 500) : [];
    if (!list.length) return NextResponse.json({ error: "Нет ключей" }, { status: 400 });
    return NextResponse.json({ keys: await setFavorites(list, Boolean(on)) });
  } catch (e) {
    return errorResponse(e);
  }
}
