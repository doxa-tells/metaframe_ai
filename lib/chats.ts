import "server-only";
import { randomUUID } from "crypto";
import { deleteItems, listItems, putJSON, readJSON } from "./storage";

// Чаты проектов: у каждого своя история и свои инструкции, друг с другом не связаны
export type ChatMsg = { role: "user" | "assistant"; content: string; images?: string[] };
export type ChatRecord = { id: string; name: string; instructions: string; messages: ChatMsg[]; createdAt: number; updatedAt: number };
export type ChatMeta = { id: string; name: string; count: number; updatedAt: number; hasInstructions: boolean };

const ID_RE = /^[a-z0-9-]{8,40}$/;
// У владельца — chats/, у пользователя — u/<uid>/chats/
const dirOf = (scope: string) => (scope ? `u/${scope}/chats/` : "chats/");
const keyOf = (id: string, scope: string) => `${dirOf(scope)}${id}.json`;
export const validChatId = (id: unknown): id is string => typeof id === "string" && ID_RE.test(id);

export async function listChats(scope = ""): Promise<ChatMeta[]> {
  const { items } = await listItems(dirOf(scope), 200);
  const all = await Promise.all(items.filter((i) => i.pathname.endsWith(".json")).map((i) => readJSON<ChatRecord>(i)));
  return all.filter((c): c is ChatRecord => Boolean(c))
    .map((c) => ({ id: c.id, name: c.name, count: c.messages.length, updatedAt: c.updatedAt, hasInstructions: Boolean(c.instructions?.trim()) }))
    .sort((a, b) => b.updatedAt - a.updatedAt);
}

export async function getChat(id: string, scope = ""): Promise<ChatRecord | null> {
  const { items } = await listItems(keyOf(id, scope), 1);
  const it = items.find((i) => i.pathname === keyOf(id, scope));
  return it ? readJSON<ChatRecord>(it) : null;
}

export async function saveChat(input: Partial<ChatRecord> & { name: string }, scope = ""): Promise<ChatRecord> {
  const now = Date.now();
  const id = validChatId(input.id) ? input.id : randomUUID().slice(0, 18);
  const prev = validChatId(input.id) ? await getChat(id, scope) : null;
  const rec: ChatRecord = {
    id,
    name: (input.name || "Без названия").slice(0, 80),
    instructions: (input.instructions ?? prev?.instructions ?? "").slice(0, 20000),
    messages: (input.messages ?? prev?.messages ?? []).slice(-300),
    createdAt: prev?.createdAt ?? now,
    updatedAt: now,
  };
  await putJSON(keyOf(id, scope), rec);
  return rec;
}

export async function deleteChat(id: string, scope = ""): Promise<void> {
  const { items } = await listItems(keyOf(id, scope), 1);
  await deleteItems(items.filter((i) => i.pathname === keyOf(id, scope)));
}
