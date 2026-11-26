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

// ---------- Телефоны ----------
// Ссылка с атрибутом download на телефоне кладёт файл в «Файлы», а во встроенных браузерах (Telegram, Instagram,
// WhatsApp) не делает ничего. Поэтому на телефоне открываем системное окно «Поделиться»: в нём есть
// «Сохранить изображение / видео» — файл попадает прямо в галерею
const TYPES: Record<string, string> = { png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", webp: "image/webp", gif: "image/gif", mp4: "video/mp4", mov: "video/quicktime", webm: "video/webm", mp3: "audio/mpeg", wav: "audio/wav" };
const typeOf = (name: string, blob: Blob) => blob.type && blob.type !== "application/octet-stream" ? blob.type : TYPES[name.split(".").pop()?.toLowerCase() ?? ""] ?? "application/octet-stream";
const onPhone = () => typeof window !== "undefined" && Boolean(window.matchMedia?.("(pointer: coarse)").matches);
function shareable(files: File[]): boolean {
  try { return typeof navigator.share === "function" && Boolean(navigator.canShare?.({ files })); } catch { return false; }
}

// Простое окно поверх страницы (без React: вызывается из обычной функции)
function sheet(build: (box: HTMLDivElement, close: () => void) => void): Promise<void> {
  return new Promise((resolve) => {
    const bg = document.createElement("div");
    bg.className = "modal-bg save-bg";
    const box = document.createElement("div");
    box.className = "save-sheet";
    const close = () => { bg.remove(); resolve(); };
    bg.addEventListener("click", (e) => { if (e.target === bg) close(); });
    build(box, close);
    bg.appendChild(box);
    document.body.appendChild(bg);
  });
}
const el = <K extends keyof HTMLElementTagNameMap>(tag: K, cls: string, text?: string) => {
  const n = document.createElement(tag);
  n.className = cls;
  if (text) n.textContent = text;
  return n;
};

async function saveOnPhone(items: { blob: Blob; name: string }[]): Promise<void> {
  const files = items.map((x) => new File([x.blob], x.name, { type: typeOf(x.name, x.blob) }));
  const many = files.length > 1;
  if (shareable(files)) {
    try { await navigator.share({ files }); return; }
    catch (e) {
      if ((e as Error).name === "AbortError") return; // человек сам закрыл окно
      // Пока файл загружался, телефон «забыл» нажатие и не даёт открыть окно сам — просим нажать ещё раз
      await sheet((box, close) => {
        box.appendChild(el("b", "", many ? `Файлы готовы: ${files.length}` : "Файл готов"));
        box.appendChild(el("p", "muted small", "Нажмите «Сохранить» и выберите «Сохранить изображение» или «Сохранить видео» — файл появится в галерее телефона."));
        const go = el("button", "btn accent wide", "Сохранить на телефон");
        go.addEventListener("click", () => { navigator.share({ files }).catch(() => {}).finally(close); });
        const no = el("button", "btn wide", "Отмена");
        no.addEventListener("click", close);
        box.append(go, no);
      });
      return;
    }
  }
  // Браузер не умеет отдавать файлы в «Поделиться» (обычно это встроенный браузер мессенджера)
  const first = items[0];
  const src = URL.createObjectURL(new Blob([first.blob], { type: typeOf(first.name, first.blob) }));
  const isImage = typeOf(first.name, first.blob).startsWith("image/");
  await sheet((box, close) => {
    box.appendChild(el("b", "", "Сохранение на телефон"));
    if (isImage && !many) {
      const img = el("img", "save-preview");
      img.src = src;
      box.appendChild(img);
      box.appendChild(el("p", "muted small", "Нажмите на картинку и удерживайте, затем выберите «Сохранить в Фото»."));
    }
    const a = el("a", "btn accent wide", many ? "Скачать первый файл" : "Скачать файлом");
    a.href = src;
    a.download = first.name;
    box.appendChild(a);
    box.appendChild(el("p", "muted small", "Не сохраняется? Вы, скорее всего, во встроенном браузере Telegram, Instagram или WhatsApp — он не умеет скачивать файлы. Откройте сайт в Safari или Chrome и скачайте там."));
    const no = el("button", "btn wide", "Закрыть");
    no.addEventListener("click", close);
    box.appendChild(no);
  });
  setTimeout(() => URL.revokeObjectURL(src), 60_000);
}

async function fetchBytes(url: string): Promise<Uint8Array> {
  let last: unknown;
  for (let i = 0; i < 3; i++) {
    try {
      const r = await fetch(url); // файлы неизменяемые — можно брать из кэша браузера
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
    const blob = new Blob([(await fetchBytes(items[0].url)) as BlobPart]);
    onProgress?.(1, 1);
    if (onPhone()) await saveOnPhone([{ blob, name: items[0].name }]);
    else saveBlob(blob, items[0].name);
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
  // На телефоне архив неудобен: отдаём файлы по отдельности в «Поделиться» — их можно сохранить в галерею разом
  if (onPhone() && failed < items.length) {
    const ready = results.flatMap((bytes, i) => (bytes ? [{ blob: new Blob([bytes as BlobPart]), name: items[i].name }] : []));
    const files = ready.map((x) => new File([x.blob], x.name, { type: typeOf(x.name, x.blob) }));
    if (ready.length <= 20 && shareable(files)) { await saveOnPhone(ready); return { failed }; }
  }
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

// Скачать один оригинал сразу файлом (без перехода на другую вкладку)
export async function downloadOriginal(url: string, name: string): Promise<void> {
  let blob: Blob;
  try {
    const r = await fetch(url);
    if (!r.ok) throw new Error(String(r.status));
    blob = await r.blob();
  } catch {
    window.open(url, "_blank", "noopener"); // запасной путь
    return;
  }
  if (onPhone()) await saveOnPhone([{ blob, name }]);
  else saveBlob(blob, name);
}
