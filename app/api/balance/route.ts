import { NextResponse } from "next/server";
import { getBalances, PROVIDERS, setBalance } from "@/lib/balance";
import { errorResponse } from "@/lib/http";
import { requireCtx } from "@/lib/me";
import type { ProviderId } from "@/lib/models";

export const maxDuration = 60;

export async function GET(req: Request) {
  try {
    await requireCtx({ admin: true });
    const force = new URL(req.url).searchParams.has("fresh");
    return NextResponse.json({ balances: await getBalances(force) });
  } catch (e) { return errorResponse(e); }
}

// { provider, amount } — задать текущий остаток (отсчёт трат начинается с этого момента); amount: null — убрать
export async function POST(req: Request) {
  try {
    await requireCtx({ admin: true });
    const { provider, amount } = (await req.json()) as { provider: ProviderId; amount: number | null };
    if (!PROVIDERS.includes(provider)) return NextResponse.json({ error: "Неизвестный провайдер" }, { status: 400 });
    if (amount !== null && (!Number.isFinite(amount) || amount < 0 || amount > 100000)) return NextResponse.json({ error: "Некорректная сумма" }, { status: 400 });
    return NextResponse.json({ balances: await setBalance(provider, amount) });
  } catch (e) { return errorResponse(e); }
}
