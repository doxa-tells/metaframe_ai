import { NextResponse } from "next/server";
import { deleteChat, getChat, listChats, saveChat, validChatId } from "@/lib/chats";
import { errorResponse } from "@/lib/http";
import { requireCtx } from "@/lib/me";

// GET — список чатов проектов (или один чат по ?id=), POST — сохранить, DELETE ?id= — удалить
export async function GET(req: Request) {
  try {
    const { scope } = await requireCtx();
    const id = new URL(req.url).searchParams.get("id");
    if (id) {
      if (!validChatId(id)) return NextResponse.json({ error: "Некорректный id" }, { status: 400 });
      return NextResponse.json({ chat: await getChat(id, scope) });
    }
    return NextResponse.json({ chats: await listChats(scope) });
  } catch (e) { return errorResponse(e); }
}

export async function POST(req: Request) {
  try {
    const { scope } = await requireCtx();
    const body = await req.json();
    return NextResponse.json({ chat: await saveChat(body, scope) });
  } catch (e) { return errorResponse(e); }
}

export async function DELETE(req: Request) {
  try {
    const { scope } = await requireCtx();
    const id = new URL(req.url).searchParams.get("id");
    if (!validChatId(id)) return NextResponse.json({ error: "Некорректный id" }, { status: 400 });
    await deleteChat(id, scope);
    return NextResponse.json({ ok: true });
  } catch (e) { return errorResponse(e); }
}
