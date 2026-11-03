import "server-only";
import { randomUUID } from "crypto";
import {
  GenRequest, Kind, buildHiggsfieldBody, buildArkImageBody, buildArkVideoBody, estimateCost, getModel, getMode, validateRequest, ARK_MODEL_IDS,
} from "./models";
import { putFile, putJSON, listItems, readJSON, deleteItems, readLocalFile, toAbsolute, StoredItem } from "./storage";
import * as hf from "./providers/higgsfield";
import { nanoBananaGenerate, fetchAsInline } from "./providers/google";
import * as ark from "./providers/byteplus";

export type JobStatus = "queued" | "in_progress" | "completed" | "failed" | "nsfw" | "canceled";
export type JobOutput = { url: string; type: "image" | "video" };

export type JobRecord = {
  id: string;
  kind: Kind;
  modelId: string;
  modeId: string;
  prompt: string;
  params: Record<string, unknown>;
  inputs: Record<string, string[]>;
  cost: number;
  provider: "google" | "higgsfield" | "byteplus" | "mock";
  providerRequestId?: string;
  status: JobStatus;
  outputs: JobOutput[];
  error?: string;
  createdAt: number;
  finishedAt?: number;
};

export const MOCK = process.env.MOCK_PROVIDERS === "1";
export const TERMINAL: JobStatus[] = ["completed", "failed", "nsfw", "canceled"];

// id = <kind>_<обратная метка времени>_<случайное>, чтобы новые шли первыми при сортировке по имени
export function newJobId(kind: Kind): string {
  const inv = String(9_999_999_999_999 - Date.now()).padStart(13, "0");
  return `${kind}_${inv}_${randomUUID().slice(0, 8)}`;
}
export function parseJobId(id: string): { kind: Kind; base: string } | null {
  const m = /^(image|video)_(\d{13}_[a-f0-9]{8})$/.exec(id);
  return m ? { kind: m[1] as Kind, base: m[2] } : null;
}
const jobPrefix = (id: string) => {
  const p = parseJobId(id)!;
  return `jobs/${p.kind}/${p.base}.`;
};
const pendingPath = (id: string) => `${jobPrefix(id)}p.json`;
const donePath = (id: string) => `${jobPrefix(id)}d.json`;

function extFrom(contentType: string | null, url: string, type: "image" | "video"): string {
  const ct = (contentType || "").split(";")[0];
  const map: Record<string, string> = {
    "image/png": "png", "image/jpeg": "jpg", "image/webp": "webp", "image/gif": "gif",
    "video/mp4": "mp4", "video/quicktime": "mov", "video/webm": "webm", "image/svg+xml": "svg",
  };
  if (map[ct]) return map[ct];
  const m = /\.([a-z0-9]{2,4})(?:\?|$)/i.exec(url);
  if (m) return m[1].toLowerCase();
  return type === "video" ? "mp4" : "png";
}

// Копируем результат к себе: Higgsfield удаляет файлы через 7 дней
async function copyOutput(id: string, index: number, out: JobOutput): Promise<JobOutput> {
  if (out.url.startsWith("/")) return out; // уже наш (мок)
  const r = await fetch(out.url, { cache: "no-store" });
  if (!r.ok || !r.body) return out; // оставим исходную ссылку
  const ct = r.headers.get("content-type") || (out.type === "video" ? "video/mp4" : "image/png");
  const url = await putFile(`out/${id}/${index}.${extFrom(ct, out.url, out.type)}`, r.body, ct);
  return { ...out, url };
}

async function loadInline(url: string, origin: string) {
  if (url.startsWith("/api/files/")) {
    const buf = await readLocalFile(url.slice("/api/files/".length));
    if (!buf) throw new hf.ProviderError("Референс не найден", 400);
    const ext = url.split(".").pop()?.toLowerCase();
    const mimeType = ext === "jpg" || ext === "jpeg" ? "image/jpeg" : ext === "webp" ? "image/webp" : "image/png";
    return { mimeType, data: buf.toString("base64") };
  }
  return fetchAsInline(toAbsolute(url, origin));
}

// BytePlus принимает публичные URL или data URI; локальные файлы (режим разработки) отдаём как data URI
async function toProviderUrl(url: string, origin: string): Promise<string> {
  if (url.startsWith("/api/files/")) {
    const inl = await loadInline(url, origin);
    return `data:${inl.mimeType};base64,${inl.data}`;
  }
  return toAbsolute(url, origin);
}

function mockSvg(prompt: string, seed: number): string {
  const hue = seed % 360;
  const safe = prompt.replace(/[<>&"]/g, " ").slice(0, 60);
  return `<svg xmlns="http://www.w3.org/2000/svg" width="768" height="1024" viewBox="0 0 768 1024">
<defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="hsl(${hue},70%,45%)"/><stop offset="1" stop-color="hsl(${(hue + 80) % 360},70%,20%)"/></linearGradient></defs>
<rect width="768" height="1024" fill="url(#g)"/><text x="40" y="980" fill="white" font-family="sans-serif" font-size="28" opacity=".85">MOCK · ${safe}</text></svg>`;
}

export async function createJob(req: GenRequest, origin: string): Promise<JobRecord> {
  const err = validateRequest(req);
  if (err) throw new hf.ProviderError(err, 400);
  const model = getModel(req.modelId)!;
  const mode = getMode(model, req.modeId);
  const id = newJobId(model.kind);
  const base: JobRecord = {
    id, kind: model.kind, modelId: model.id, modeId: mode.id,
    prompt: (req.prompt ?? "").trim(), params: req.params ?? {}, inputs: req.inputs ?? {},
    cost: estimateCost(req), provider: MOCK ? "mock" : model.provider,
    status: "queued", outputs: [], createdAt: Date.now(),
  };

  if (MOCK) {
    if (model.kind === "image") {
      const n = Number(req.params.count ?? req.params.batch_size ?? 1) || 1;
      const outputs: JobOutput[] = [];
      for (let i = 0; i < n; i++) {
        const url = await putFile(`out/${id}/${i}.svg`, mockSvg(base.prompt, Date.now() + i * 47), "image/svg+xml");
        outputs.push({ url, type: "image" });
      }
      const rec = { ...base, status: "completed" as const, outputs, finishedAt: Date.now() };
      await putJSON(donePath(id), rec);
      return rec;
    }
    const rec = { ...base, providerRequestId: `mock:${Date.now()}` };
    await putJSON(pendingPath(id), rec);
    return rec;
  }

  if (model.provider === "google") {
    try {
      const refs = await Promise.all((req.inputs.refs ?? []).filter(Boolean).map((u) => loadInline(u, origin)));
      const count = Math.min(4, Math.max(1, Number(req.params.count ?? 1)));
      const results = await Promise.allSettled(
        Array.from({ length: count }, () => nanoBananaGenerate({
          prompt: base.prompt, refs,
          aspectRatio: String(req.params.aspect_ratio ?? "auto"),
          imageSize: String(req.params.image_size ?? "2K"),
          thinking: req.params.thinking ? String(req.params.thinking) : undefined,
        })),
      );
      const images = results.flatMap((r) => (r.status === "fulfilled" ? r.value : []));
      if (!images.length) {
        const first = results.find((r) => r.status === "rejected") as PromiseRejectedResult | undefined;
        throw first?.reason ?? new Error("Нет результата");
      }
      const outputs: JobOutput[] = [];
      for (let i = 0; i < images.length; i++) {
        const img = images[i];
        const url = await putFile(`out/${id}/${i}.${extFrom(img.mimeType, "", "image")}`, img.data, img.mimeType);
        outputs.push({ url, type: "image" });
      }
      // Платим только за реально полученные картинки
      const perImage = base.cost / count;
      const rec: JobRecord = { ...base, status: "completed", outputs, cost: Math.round(perImage * images.length * 10000) / 10000, finishedAt: Date.now() };
      await putJSON(donePath(id), rec);
      return rec;
    } catch (e) {
      const rec: JobRecord = { ...base, status: "failed", cost: 0, error: (e as Error).message, finishedAt: Date.now() };
      await putJSON(donePath(id), rec);
      return rec;
    }
  }

  if (model.provider === "byteplus") {
    const arkModel = ark.arkModelId(model.id, ARK_MODEL_IDS[model.id]);
    const conv: Record<string, string[]> = {};
    for (const [k, v] of Object.entries(req.inputs ?? {})) conv[k] = await Promise.all((v ?? []).filter(Boolean).map((u) => toProviderUrl(u, origin)));
    if (model.kind === "video") {
      const taskId = await ark.seedanceSubmit(buildArkVideoBody({ ...req, inputs: conv }, arkModel));
      const rec: JobRecord = { ...base, providerRequestId: `ark:${taskId}` };
      await putJSON(pendingPath(id), rec);
      return rec;
    }
    try {
      const count = Math.min(4, Math.max(1, Number(req.params.count ?? 1)));
      const body = buildArkImageBody(req, arkModel, conv.refs ?? []);
      const results = await Promise.allSettled(Array.from({ length: count }, () => ark.seedreamGenerate(body)));
      const urls = results.flatMap((r) => (r.status === "fulfilled" ? r.value : []));
      if (!urls.length) {
        const first = results.find((r) => r.status === "rejected") as PromiseRejectedResult | undefined;
        throw first?.reason ?? new Error("Нет результата");
      }
      const outputs: JobOutput[] = [];
      for (let i = 0; i < urls.length; i++) outputs.push(await copyOutput(id, i, { url: urls[i], type: "image" }));
      const rec: JobRecord = { ...base, status: "completed", outputs, cost: Math.round((base.cost / count) * urls.length * 10000) / 10000, finishedAt: Date.now() };
      await putJSON(donePath(id), rec);
      return rec;
    } catch (e) {
      const rec: JobRecord = { ...base, status: "failed", cost: 0, error: (e as Error).message, finishedAt: Date.now() };
      await putJSON(donePath(id), rec);
      return rec;
    }
  }

  // Higgsfield: асинхронно, сохраняем задачу и отдаём клиенту для опроса
  const absInputs: Record<string, string[]> = {};
  for (const [k, v] of Object.entries(req.inputs ?? {})) absInputs[k] = (v ?? []).filter(Boolean).map((u) => toAbsolute(u, origin));
  const { endpoint, body } = buildHiggsfieldBody({ ...req, inputs: absInputs });
  const sub = await hf.submit(endpoint, body, id);
  const rec: JobRecord = { ...base, providerRequestId: sub.request_id, status: (sub.status as JobStatus) || "queued" };
  await putJSON(pendingPath(id), rec);
  return rec;
}

async function findJobFiles(id: string): Promise<{ pending?: StoredItem; done?: StoredItem }> {
  const { items } = await listItems(jobPrefix(id), 10);
  return {
    pending: items.find((i) => i.pathname.endsWith(".p.json")),
    done: items.find((i) => i.pathname.endsWith(".d.json")),
  };
}

async function finalize(id: string, patch: Partial<JobRecord>): Promise<JobRecord | null> {
  const files = await findJobFiles(id);
  if (files.done) return readJSON<JobRecord>(files.done);
  if (!files.pending) return null;
  const rec = await readJSON<JobRecord>(files.pending);
  if (!rec) return null;
  const outputs: JobOutput[] = [];
  for (let i = 0; i < (patch.outputs ?? []).length; i++) {
    outputs.push(await copyOutput(id, i, patch.outputs![i]));
  }
  const done: JobRecord = { ...rec, ...patch, outputs, finishedAt: Date.now() };
  if (done.status !== "completed") done.cost = 0;
  await putJSON(donePath(id), done);
  await deleteItems([files.pending]).catch(() => {});
  return done;
}

// Опрос статуса: обращаемся к хранилищу только при завершении, чтобы не тратить операции Blob
export async function pollJob(id: string, providerRequestId: string): Promise<Partial<JobRecord> & { id: string; status: JobStatus }> {
  if (!parseJobId(id)) throw new hf.ProviderError("Некорректный id", 400);
  if (providerRequestId.startsWith("mock:")) {
    const started = Number(providerRequestId.slice(5));
    if (Date.now() - started < 8000) return { id, status: Date.now() - started < 3000 ? "queued" : "in_progress" };
    const done = await finalize(id, { status: "completed", outputs: [{ url: "/mock.mp4", type: "video" }] });
    return done ?? { id, status: "failed", error: "Задача не найдена" };
  }
  if (providerRequestId.startsWith("ark:")) {
    const as = await ark.seedanceStatus(providerRequestId.slice(4));
    if (!TERMINAL.includes(as.status)) return { id, status: as.status };
    const outs: JobOutput[] = as.videoUrl ? [{ url: as.videoUrl, type: "video" }] : [];
    const st2: JobStatus = as.status === "completed" && !outs.length ? "failed" : as.status;
    const err2 = st2 === "completed" ? undefined : as.error || (st2 === "canceled" ? "Отменено" : "Генерация не удалась");
    const done = await finalize(id, { status: st2, outputs: outs, error: err2 });
    return done ?? { id, status: st2, outputs: outs, error: err2 };
  }
  let st: hf.HfStatus;
  try {
    st = await hf.getStatus(providerRequestId);
  } catch (e) {
    const pe = e as hf.ProviderError;
    if (pe.status === 404) {
      const done = await finalize(id, { status: "failed", error: "Задача не найдена у провайдера (возможно, истекла)" });
      return done ?? { id, status: "failed", error: pe.message };
    }
    throw e;
  }
  if (!TERMINAL.includes(st.status)) return { id, status: st.status };
  const errText = st.status === "nsfw" ? "Отклонено модерацией (NSFW)" :
    st.status === "canceled" ? "Отменено" : st.status === "failed" ? (st.error || "Генерация не удалась") : undefined;
  const done = await finalize(id, { status: st.status, outputs: st.outputs, error: errText });
  return done ?? { id, status: st.status, outputs: st.outputs, error: errText };
}

export async function cancelJob(providerRequestId: string): Promise<void> {
  if (providerRequestId.startsWith("mock:")) return;
  if (providerRequestId.startsWith("ark:")) { await ark.seedanceCancel(providerRequestId.slice(4)); return; }
  await hf.cancel(providerRequestId);
}

export async function listJobs(kind: Kind, cursor?: string): Promise<{ jobs: JobRecord[]; cursor?: string }> {
  const { items, cursor: next } = await listItems(`jobs/${kind}/`, 40, cursor);
  const byBase = new Map<string, StoredItem>();
  for (const it of items) {
    const base = it.pathname.replace(/\.(p|d)\.json$/, "");
    const prev = byBase.get(base);
    if (!prev || it.pathname.endsWith(".d.json")) byBase.set(base, it);
  }
  const jobs = (await Promise.all([...byBase.values()].map((i) => readJSON<JobRecord>(i)))).filter(Boolean) as JobRecord[];
  jobs.sort((a, b) => b.createdAt - a.createdAt);
  return { jobs, cursor: next };
}

export async function deleteJob(id: string): Promise<void> {
  if (!parseJobId(id)) throw new hf.ProviderError("Некорректный id", 400);
  const a = await listItems(jobPrefix(id), 10);
  const b = await listItems(`out/${id}/`, 20);
  await deleteItems([...a.items, ...b.items]);
}
