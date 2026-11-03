import { NextResponse } from "next/server";
import { createJob } from "@/lib/jobs";
import { errorResponse, requestOrigin } from "@/lib/http";
import type { GenRequest } from "@/lib/models";

export const maxDuration = 300;

export async function POST(req: Request) {
  try {
    const body = (await req.json()) as GenRequest;
    const job = await createJob(body, requestOrigin(req));
    return NextResponse.json({ job });
  } catch (e) {
    return errorResponse(e);
  }
}
