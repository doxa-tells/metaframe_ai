import { NextResponse } from "next/server";
import { cancelJob, cancelQueued, jobScope, storedProviderId } from "@/lib/jobs";
import { errorResponse, readJsonBody } from "@/lib/http";
import { requireCtx } from "@/lib/me";

export async function POST(req: Request) {
  try {
    const me = await requireCtx({ member: true });
    const { id, providerRequestId } = await readJsonBody<{ id?: string; providerRequestId: string }>(req, 4096);
    if (typeof providerRequestId !== "string" || !providerRequestId) return NextResponse.json({ error: "Не найдено" }, { status: 404 });
    // Отменять можно только свою задачу и только тот запрос провайдера, который в ней записан
    const mine = typeof id === "string" && (me.admin ? jobScope(id) !== null : jobScope(id) === me.scope);
    const real = mine ? await storedProviderId(id!) : null;
    if (!me.admin && (!real || (real !== providerRequestId && !providerRequestId.startsWith("wait:")))) {
      return NextResponse.json({ error: "Не найдено" }, { status: 404 });
    }
    // Ждёт в очереди студии — провайдеру не уходила: закрываем сами, кредиты возвращаются
    if (id && real?.startsWith("wait:")) { await cancelQueued(id); return NextResponse.json({ ok: true }); }
    await cancelJob(real ?? providerRequestId);
    return NextResponse.json({ ok: true });
  } catch (e) {
    return errorResponse(e);
  }
}
