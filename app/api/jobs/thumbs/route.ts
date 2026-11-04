import { NextResponse } from "next/server";
import { ensureThumbs } from "@/lib/jobs";
import { errorResponse, requestOrigin } from "@/lib/http";

export const maxDuration = 60;

// Догенерация превью для старых картинок, у которых их ещё нет
export async function POST(req: Request) {
  try {
    const { ids } = (await req.json()) as { ids?: unknown };
    const list = Array.isArray(ids) ? ids.filter((x): x is string => typeof x === "string") : [];
    return NextResponse.json({ jobs: await ensureThumbs(list, requestOrigin(req)) });
  } catch (e) {
    return errorResponse(e);
  }
}
