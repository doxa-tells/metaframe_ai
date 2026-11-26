import "server-only";
import { randomUUID } from "crypto";
import { listItems, putJSON, readJSON } from "./storage";

// Сохранённые промпты аккаунта: шаблоны, которые человек вставляет в поле генерации.
// У владельца — settings/prompts.json, у пользователя — u/<uid>/prompts.json (один файл: одно чтение на открытие окна)
export type SavedPrompt = { id: string; title: string; text: string; at: number };
export const PROMPTS_MAX = 200;
export const PROMPT_TITLE_MAX = 80;
export const PROMPT_TEXT_MAX = 20_000; // как у поля генерации (MAX_PROMPT)

const keyOf = (scope: string) => (scope ? `u/${scope}/prompts.json` : "settings/prompts.json");
type Store = { items: SavedPrompt[] };

async function read(scope: string): Promise<SavedPrompt[]> {
  const KEY = keyOf(scope);
  const { items } = await listItems(KEY, 1);
  const it = items.find((i) => i.pathname === KEY);
  const d = it ? await readJSON<Store>(it) : null;
  return Array.isArray(d?.items)
    ? d!.items.filter((p) => p && typeof p.id === "string" && typeof p.title === "string" && typeof p.text === "string")
    : [];
}

export const getPrompts = (scope = "") => read(scope);

// Записи одного аккаунта идут по очереди, чтобы быстрые правки не затирали друг друга
const chains = new Map<string, Promise<unknown>>();
function write(scope: string, fn: (cur: SavedPrompt[]) => SavedPrompt[]): Promise<SavedPrompt[]> {
  const run = (chains.get(scope) ?? Promise.resolve()).then(async () => {
    const next = fn(await read(scope));
    await putJSON(keyOf(scope), { items: next } satisfies Store);
    return next;
  });
  chains.set(scope, run.catch(() => {}));
  if (chains.size > 500) chains.delete(chains.keys().next().value!);
  return run;
}

const fail = (message: string, status = 400) => Object.assign(new Error(message), { status });

// Новый промпт (без id) встаёт первым; правка существующего сохраняет его место
export function savePrompt(scope: string, input: { id?: string; title: string; text: string }): Promise<SavedPrompt[]> {
  const title = input.title.trim().replace(/\s+/g, " ").slice(0, PROMPT_TITLE_MAX);
  const text = input.text.trim();
  if (!text) throw fail("Введите текст промпта");
  if (text.length > PROMPT_TEXT_MAX) throw fail(`Промпт длиннее ${PROMPT_TEXT_MAX} символов`);
  const name = title || text.replace(/\s+/g, " ").slice(0, 40);
  return write(scope, (cur) => {
    if (input.id) {
      if (!cur.some((p) => p.id === input.id)) throw fail("Промпт не найден — обновите окно", 404);
      return cur.map((p) => (p.id === input.id ? { ...p, title: name, text, at: Date.now() } : p));
    }
    if (cur.length >= PROMPTS_MAX) throw fail(`Можно сохранить не больше ${PROMPTS_MAX} промптов — удалите ненужные`);
    return [{ id: randomUUID().slice(0, 12), title: name, text, at: Date.now() }, ...cur];
  });
}

export function deletePrompt(scope: string, id: string): Promise<SavedPrompt[]> {
  return write(scope, (cur) => cur.filter((p) => p.id !== id));
}
