import { NextResponse } from "next/server";
import { ensureThumbs, jobScope } from "@/lib/jobs";
import { errorResponse, readJsonBody, requestOrigin } from "@/lib/http";
import { requireCtx } from "@/lib/me";

export const maxDuration = 60;

// Догенерация превью для старых картинок, у которых их ещё нет
export async function POST(req: Request) {
  try {
    const me = await requireCtx({ member: true });
    const { ids } = await readJsonBody<{ ids?: unknown }>(req, 65_536);
    const list = Array.isArray(ids) ? ids.filter((x): x is string => typeof x === "string" && jobScope(x) === me.scope) : [];
    return NextResponse.json({ jobs: await ensureThumbs(list, requestOrigin(req)) });
  } catch (e) {
    return errorResponse(e);
  }
}
