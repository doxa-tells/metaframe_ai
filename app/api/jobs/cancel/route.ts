import { NextResponse } from "next/server";
import { cancelJob } from "@/lib/jobs";
import { errorResponse } from "@/lib/http";

export async function POST(req: Request) {
  try {
    const { providerRequestId } = (await req.json()) as { providerRequestId: string };
    await cancelJob(providerRequestId);
    return NextResponse.json({ ok: true });
  } catch (e) {
    return errorResponse(e);
  }
}
