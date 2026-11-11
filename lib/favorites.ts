import "server-only";
import { listItems, putJSON, readJSON } from "./storage";

// Избранное: ключи «<id задачи>:<номер результата>»
// У владельца — settings/favorites.json, у пользователя — u/<uid>/favorites.json
const keyOf = (scope: string) => (scope ? `u/${scope}/favorites.json` : "settings/favorites.json");
type Store = { keys: string[] };

async function read(scope: string): Promise<string[]> {
  const KEY = keyOf(scope);
  const { items } = await listItems(KEY, 1);
  const it = items.find((i) => i.pathname === KEY);
  const d = it ? await readJSON<Store>(it) : null;
  return Array.isArray(d?.keys) ? d!.keys.filter((k) => typeof k === "string") : [];
}

let chain: Promise<unknown> = Promise.resolve();

export const getFavorites = (scope = "") => read(scope);

// Записи идут по очереди, чтобы быстрые клики не затирали друг друга
export function setFavorites(keys: string[], on: boolean, scope = ""): Promise<string[]> {
  const run = chain.then(async () => {
    const cur = new Set(await read(scope));
    for (const k of keys) { if (on) cur.add(k); else cur.delete(k); }
    const next = [...cur].slice(-5000);
    await putJSON(keyOf(scope), { keys: next } satisfies Store);
    return next;
  });
  chain = run.catch(() => {});
  return run;
}
