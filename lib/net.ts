import "server-only";

// Сетевые сбои (обрыв соединения, таймаут) — в отличие от ошибок HTTP, ответа нет вообще
export function isNetworkError(e: unknown): boolean {
  return e instanceof TypeError && /fetch failed|network|socket|terminated/i.test((e as Error).message);
}

// Человекочитаемое описание: куда не дошёл запрос и почему (ECONNRESET, таймаут и т.п.)
export function describeNetError(e: unknown, where: string): Error {
  if (!isNetworkError(e)) return e as Error;
  const cause = (e as { cause?: { code?: string; message?: string } }).cause;
  const why = cause?.code || cause?.message || (e as Error).message;
  return Object.assign(new Error(`Нет связи с ${where} (${why})`), { status: 502 });
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// Повтор при временных сбоях с нарастающей паузой
export async function withRetry<T>(fn: (attempt: number) => Promise<T>, opts: { tries?: number; retryIf?: (e: unknown) => boolean; baseDelay?: number } = {}): Promise<T> {
  const tries = opts.tries ?? 3;
  const retryIf = opts.retryIf ?? isNetworkError;
  let last: unknown;
  for (let i = 0; i < tries; i++) {
    try {
      return await fn(i);
    } catch (e) {
      last = e;
      if (i === tries - 1 || !retryIf(e)) break;
      await sleep((opts.baseDelay ?? 800) * (i + 1));
    }
  }
  throw last;
}
