import { NextResponse } from "next/server";
import { listJobs } from "@/lib/jobs";
import { errorResponse } from "@/lib/http";
import { requireCtx } from "@/lib/me";

// Каждый видит только свои генерации
export async function GET(req: Request) {
  try {
    const { scope } = await requireCtx();
    const u = new URL(req.url);
    const kind = u.searchParams.get("kind") === "video" ? "video" : "image";
    const cursor = u.searchParams.get("cursor") || undefined;
    return NextResponse.json(await listJobs(kind, cursor, scope));
  } catch (e) {
    return errorResponse(e);
  }
}
