import { NextResponse } from "next/server";
import { errorResponse, readJsonBody } from "@/lib/http";
import { requireCtx } from "@/lib/me";
import { deletePrompt, getPrompts, savePrompt } from "@/lib/prompts";
import { tooMany } from "@/lib/ratelimit";

// Сохранённые промпты аккаунта (окно «Промпты» в генерации)
export async function GET() {
  try {
    const ctx = await requireCtx({ member: true });
    return NextResponse.json({ items: await getPrompts(ctx.scope) });
  } catch (e) {
    return errorResponse(e);
  }
}

const busy = (uid: string) => tooMany(`prompts:${uid || "owner"}`, 40, 60_000);
const BUSY = { error: "Слишком много правок подряд — подождите минуту" };

// { title, text } — новый промпт; { id, title, text } — правка
export async function POST(req: Request) {
  try {
    const ctx = await requireCtx({ member: true });
    if (busy(ctx.uid)) return NextResponse.json(BUSY, { status: 429 });
    const b = await readJsonBody<{ id?: unknown; title?: unknown; text?: unknown }>(req, 65_536);
    if (typeof b.text !== "string" || (b.title !== undefined && typeof b.title !== "string") || (b.id !== undefined && typeof b.id !== "string")) {
      return NextResponse.json({ error: "Некорректный запрос" }, { status: 400 });
    }
    return NextResponse.json({ items: await savePrompt(ctx.scope, { id: b.id as string | undefined, title: (b.title as string | undefined) ?? "", text: b.text }) });
  } catch (e) {
    return errorResponse(e);
  }
}

export async function DELETE(req: Request) {
  try {
    const ctx = await requireCtx({ member: true });
    if (busy(ctx.uid)) return NextResponse.json(BUSY, { status: 429 });
    const { id } = await readJsonBody<{ id?: unknown }>(req, 1024);
    if (typeof id !== "string" || !id) return NextResponse.json({ error: "Нет id" }, { status: 400 });
    return NextResponse.json({ items: await deletePrompt(ctx.scope, id) });
  } catch (e) {
    return errorResponse(e);
  }
}
