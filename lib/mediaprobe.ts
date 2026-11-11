import "server-only";
import { localKeyOf, readLocalFile, toAbsolute } from "./storage";

// Длительность видео на сервере (а не со слов браузера): читаем заголовок mvhd из MP4/MOV.
// Сначала первые 512 КБ (faststart), если moov в конце — последние 4 МБ. Не получилось — null.
const HEAD = 512 * 1024;
const TAIL = 4 * 1024 * 1024;

async function readBytes(url: string, range: string, cap: number): Promise<Buffer | null> {
  try {
    const r = await fetch(url, { headers: { Range: range }, cache: "no-store", signal: AbortSignal.timeout(15_000) });
    if (!r.ok || !r.body) return null;
    // Если сервер проигнорировал Range и отдаёт весь файл — читаем не больше cap
    const reader = r.body.getReader();
    const chunks: Uint8Array[] = [];
    let n = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(value);
      n += value.length;
      if (n >= cap) { await reader.cancel().catch(() => {}); break; }
    }
    return Buffer.concat(chunks);
  } catch { return null; }
}

export function mvhdSeconds(buf: Buffer): number | null {
  for (let i = buf.indexOf("mvhd"); i >= 0; i = buf.indexOf("mvhd", i + 4)) {
    const v = buf[i + 4];
    let ts: number, dur: number;
    if (v === 0 && i + 24 <= buf.length) { ts = buf.readUInt32BE(i + 16); dur = buf.readUInt32BE(i + 20); }
    else if (v === 1 && i + 36 <= buf.length) { ts = buf.readUInt32BE(i + 24); dur = Number(buf.readBigUInt64BE(i + 28)); }
    else continue;
    if (ts > 0 && dur > 0 && dur !== 0xffffffff) {
      const s = dur / ts;
      if (s > 0 && s < 24 * 3600) return Math.round(s * 10) / 10;
    }
  }
  return null;
}

export async function videoSeconds(url: string, origin: string): Promise<number | null> {
  const lk = localKeyOf(url);
  if (lk) {
    const b = await readLocalFile(lk);
    if (b) return mvhdSeconds(b);
  }
  const abs = toAbsolute(url, origin);
  const head = await readBytes(abs, `bytes=0-${HEAD - 1}`, HEAD);
  if (!head) return null;
  const a = mvhdSeconds(head);
  if (a) return a;
  if (head.length < HEAD) return null; // файл целиком, а mvhd нет — не MP4
  const tail = await readBytes(abs, `bytes=-${TAIL}`, TAIL);
  return tail ? mvhdSeconds(tail) : null;
}
