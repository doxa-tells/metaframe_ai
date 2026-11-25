import { NextResponse } from "next/server";
import { jobScope, pollJob, storedProviderId } from "@/lib/jobs";
import { errorResponse, readJsonBody } from "@/lib/http";
import { requireCtx } from "@/lib/me";

export const maxDuration = 300;

// Пары «задача → запрос провайдера», уже сверенные с хранилищем (чтобы не читать запись на каждом опросе)
const verified = new Map<string, string>();

export async function POST(req: Request) {
  try {
    const me = await requireCtx({ member: true });
    const { id, providerRequestId } = await readJsonBody<{ id: string; providerRequestId: string }>(req, 4096);
    if (typeof id !== "string" || typeof providerRequestId !== "string" || !id || !providerRequestId) return NextResponse.json({ error: "id и providerRequestId обязательны" }, { status: 400 });
    if (jobScope(id) !== me.scope) return NextResponse.json({ error: "Не найдено" }, { status: 404 });
    // Задача из очереди студии: настоящий запрос провайдера появляется после старта — берём его из записи
    if (providerRequestId.startsWith("wait:")) {
      const real = await storedProviderId(id);
      if (!real) return NextResponse.json({ error: "Не найдено" }, { status: 404 });
      return NextResponse.json({ job: await pollJob(id, real) });
    }
    // Пользователь не должен подставить чужой запрос провайдера в свою задачу
    if (!me.admin && verified.get(id) !== providerRequestId) {
      const real = await storedProviderId(id);
      if (real !== providerRequestId) return NextResponse.json({ error: "Не найдено" }, { status: 404 });
      if (verified.size > 5000) verified.delete(verified.keys().next().value!);
      verified.set(id, real);
    }
    return NextResponse.json({ job: await pollJob(id, providerRequestId) });
  } catch (e) {
    return errorResponse(e);
  }
}
