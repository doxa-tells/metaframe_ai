"use client";
import { Zip, ZipPassThrough } from "fflate";

export type ArchiveItem = { url: string; name: string };

function saveBlob(blob: Blob, name: string) {
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 60_000);
}

async function fetchBytes(url: string): Promise<Uint8Array> {
  let last: unknown;
  for (let i = 0; i < 3; i++) {
    try {
      const r = await fetch(url, { cache: "no-store" });
      if (!r.ok) throw new Error(`${r.status}`);
      return new Uint8Array(await r.arrayBuffer());
    } catch (e) {
      last = e;
      await new Promise((res) => setTimeout(res, 600 * (i + 1)));
    }
  }
  throw last;
}

// Скачивание: один файл — как есть, несколько — ZIP (без сжатия: картинки и видео уже сжаты)
export async function downloadItems(items: ArchiveItem[], zipName: string, onProgress?: (done: number, total: number) => void): Promise<{ failed: number }> {
  if (items.length === 1) {
    const bytes = await fetchBytes(items[0].url);
    saveBlob(new Blob([bytes as BlobPart]), items[0].name);
    onProgress?.(1, 1);
    return { failed: 0 };
  }
  const chunks: Uint8Array[] = [];
  const zip = new Zip((err, data) => { if (err) throw err; chunks.push(data); });
  let done = 0;
  let failed = 0;
  // Загружаем по 4 файла одновременно, в архив добавляем по порядку
  const results: (Uint8Array | null)[] = new Array(items.length).fill(null);
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(4, items.length) }, async () => {
    while (next < items.length) {
      const i = next++;
      try { results[i] = await fetchBytes(items[i].url); } catch { failed++; }
      onProgress?.(++done, items.length);
    }
  }));
  results.forEach((bytes, i) => {
    if (!bytes) return;
    const entry = new ZipPassThrough(items[i].name);
    zip.add(entry);
    entry.push(bytes, true);
  });
  zip.end();
  if (failed === items.length) throw new Error("Не удалось скачать ни одного файла");
  saveBlob(new Blob(chunks as BlobPart[], { type: "application/zip" }), zipName);
  return { failed };
}

// Понятное имя файла: дата, начало промпта, номер
export function fileNameFor(prompt: string, createdAt: number, index: number, url: string, used: Set<string>): string {
  const d = new Date(createdAt);
  const pad = (n: number) => String(n).padStart(2, "0");
  const stamp = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}_${pad(d.getHours())}${pad(d.getMinutes())}`;
  const slug = prompt.toLowerCase().replace(/[^a-zа-яё0-9]+/gi, "-").replace(/^-+|-+$/g, "").slice(0, 40) || "image";
  const ext = (/\.([a-z0-9]{2,4})(?:\?|$)/i.exec(url)?.[1] ?? "png").toLowerCase();
  let name = `${stamp}_${slug}_${index + 1}.${ext}`;
  for (let n = 2; used.has(name); n++) name = `${stamp}_${slug}_${index + 1}-${n}.${ext}`;
  used.add(name);
  return name;
}
