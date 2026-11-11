import { NextResponse } from "next/server";
import { errorResponse } from "@/lib/http";
import { requireCtx } from "@/lib/me";
import { listLog } from "@/lib/modlog";
import { validUid } from "@/lib/users";

export async function GET(req: Request) {
  try {
    await requireCtx({ admin: true });
    const u = new URL(req.url);
    const uid = u.searchParams.get("uid");
    return NextResponse.json(await listLog({ userId: uid && validUid(uid) ? uid : undefined, cursor: u.searchParams.get("cursor") || undefined }));
  } catch (e) {
    return errorResponse(e);
  }
}
