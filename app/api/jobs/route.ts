import { NextResponse } from "next/server";
import { listJobs } from "@/lib/jobs";
import { errorResponse } from "@/lib/http";

export async function GET(req: Request) {
  try {
    const u = new URL(req.url);
    const kind = u.searchParams.get("kind") === "video" ? "video" : "image";
    const cursor = u.searchParams.get("cursor") || undefined;
    return NextResponse.json(await listJobs(kind, cursor));
  } catch (e) {
    return errorResponse(e);
  }
}
