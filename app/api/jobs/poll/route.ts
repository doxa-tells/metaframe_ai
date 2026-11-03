import { NextResponse } from "next/server";
import { pollJob } from "@/lib/jobs";
import { errorResponse } from "@/lib/http";

export const maxDuration = 300;

export async function POST(req: Request) {
  try {
    const { id, providerRequestId } = (await req.json()) as { id: string; providerRequestId: string };
    if (!id || !providerRequestId) return NextResponse.json({ error: "id и providerRequestId обязательны" }, { status: 400 });
    return NextResponse.json({ job: await pollJob(id, providerRequestId) });
  } catch (e) {
    return errorResponse(e);
  }
}
