// Простой ограничитель частоты в памяти функции (от перебора паролей и спама регистраций)
const hits = new Map<string, number[]>();

export function tooMany(key: string, max: number, windowMs: number): boolean {
  const now = Date.now();
  const arr = (hits.get(key) ?? []).filter((t) => now - t < windowMs);
  arr.push(now);
  hits.set(key, arr);
  if (hits.size > 10_000) hits.delete(hits.keys().next().value!);
  return arr.length > max;
}
