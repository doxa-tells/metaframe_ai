import { NextResponse, type NextRequest } from "next/server";
import { createHmac, timingSafeEqual } from "crypto";
import { sweepPending } from "@/lib/jobs";

export const maxDuration = 60;

// Будильник от воркера хранилища (раз в 2 минуты): запускает задачи из очереди и доводит незавершённые,
// даже когда ни у кого не открыта студия. Подпись — HMAC от времени общим секретом хранилища
export async function POST(req: NextRequest) {
  const secret = (process.env.STORAGE_SECRET || "").trim();
  const ts = Number(req.nextUrl.searchParams.get("ts"));
  const sig = req.nextUrl.searchParams.get("sig") ?? "";
  if (!secret || !Number.isFinite(ts) || Math.abs(Date.now() / 1000 - ts) > 300) return NextResponse.json({ error: "Не найдено" }, { status: 404 });
  const want = createHmac("sha256", secret).update(`cron:${ts}`).digest("hex");
  if (sig.length !== want.length || !timingSafeEqual(Buffer.from(sig), Buffer.from(want))) return NextResponse.json({ error: "Не найдено" }, { status: 404 });
  try {
    return NextResponse.json(await sweepPending({ force: true, budgetMs: 45_000 }));
  } catch (e) {
    console.error("cron sweep:", (e as Error).message);
    return NextResponse.json({ error: "Ошибка" }, { status: 500 });
  }
}
