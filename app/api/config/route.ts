import { NextResponse } from "next/server";
import { higgsfieldKey } from "@/lib/providers/higgsfield";
import { googleKey } from "@/lib/providers/google";
import { arkKey } from "@/lib/providers/byteplus";
import { storageMode, storageMissing } from "@/lib/storage";
import { MOCK } from "@/lib/jobs";

export async function GET() {
  return NextResponse.json({
    mock: MOCK,
    storage: storageMode,
    storageMissing,
    providers: {
      google: Boolean(googleKey()),
      higgsfield: Boolean(higgsfieldKey()),
      byteplus: Boolean(arkKey()),
      anthropic: Boolean(process.env.ANTHROPIC_API_KEY),
    },
  });
}
