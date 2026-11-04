import { NextResponse } from "next/server";
import { deleteChat, getChat, listChats, saveChat, validChatId } from "@/lib/chats";
import { errorResponse } from "@/lib/http";

// GET — список чатов проектов (или один чат по ?id=), POST — сохранить, DELETE ?id= — удалить
export async function GET(req: Request) {
  try {
    const id = new URL(req.url).searchParams.get("id");
    if (id) {
      if (!validChatId(id)) return NextResponse.json({ error: "Некорректный id" }, { status: 400 });
      return NextResponse.json({ chat: await getChat(id) });
    }
    return NextResponse.json({ chats: await listChats() });
  } catch (e) { return errorResponse(e); }
}

export async function POST(req: Request) {
  try {
    const body = await req.json();
    return NextResponse.json({ chat: await saveChat(body) });
  } catch (e) { return errorResponse(e); }
}

export async function DELETE(req: Request) {
  try {
    const id = new URL(req.url).searchParams.get("id");
    if (!validChatId(id)) return NextResponse.json({ error: "Некорректный id" }, { status: 400 });
    await deleteChat(id);
    return NextResponse.json({ ok: true });
  } catch (e) { return errorResponse(e); }
}
