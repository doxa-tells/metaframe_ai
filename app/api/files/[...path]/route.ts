import { readLocalFile } from "@/lib/storage";

const TYPES: Record<string, string> = {
  png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", webp: "image/webp", gif: "image/gif", svg: "image/svg+xml",
  mp4: "video/mp4", mov: "video/quicktime", webm: "video/webm", wav: "audio/wav", mp3: "audio/mpeg", json: "application/json",
};

// Раздача локальных файлов (только режим разработки без Vercel Blob)
export async function GET(_req: Request, ctx: { params: Promise<{ path: string[] }> }) {
  const { path } = await ctx.params;
  const pathname = path.map(decodeURIComponent).join("/");
  if (pathname.includes("..")) return new Response("bad path", { status: 400 });
  const buf = await readLocalFile(pathname);
  if (!buf) return new Response("not found", { status: 404 });
  const ext = pathname.split(".").pop()?.toLowerCase() ?? "";
  return new Response(new Uint8Array(buf), { headers: { "Content-Type": TYPES[ext] ?? "application/octet-stream", "Cache-Control": "private, max-age=3600" } });
}
