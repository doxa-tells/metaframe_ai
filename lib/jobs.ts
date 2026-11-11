import "server-only";
import { randomUUID } from "crypto";
import {
  GenRequest, Kind, buildHiggsfieldBody, buildArkImageBody, buildArkVideoBody, estimateCost, getModel, getMode, validateRequest, resolveRequest, buildOmniPlan, ARK_MODEL_IDS,
} from "./models";
import { describeNetError } from "./net";
import { putFile, putJSON, listItems, readJSON, deleteItems, readLocalFile, toAbsolute, localKeyOf, StoredItem } from "./storage";
import * as hf from "./providers/higgsfield";
import { nanoBananaGenerate, fetchAsInline, omniSubmit, omniStatus, omniDownload, omniCancel, omniDelete } from "./providers/google";
import * as ark from "./providers/byteplus";
import { withBase } from "./base";

export type JobStatus = "queued" | "in_progress" | "completed" | "failed" | "nsfw" | "canceled";
export type JobOutput = { url: string; type: "image" | "video"; thumb?: string }; // thumb — лёгкая превью-картинка для сетки

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
  userId?: string; // кто запустил (для пользователей; у владельца пусто)
  ip?: string;
};

export const MOCK = process.env.MOCK_PROVIDERS === "1";
export const TERMINAL: JobStatus[] = ["completed", "failed", "nsfw", "canceled"];

// id = <kind>_<обратная метка времени>_<случайное>, чтобы новые шли первыми при сортировке по имени
// У пользователей к id добавляется их uid, а задачи лежат в их собственной папке u/<uid>/jobs/
export function newJobId(kind: Kind, uid = ""): string {
  const inv = String(9_999_999_999_999 - Date.now()).padStart(13, "0");
  return `${kind}_${inv}_${randomUUID().slice(0, 8)}${uid ? `_${uid}` : ""}`;
}
export function parseJobId(id: string): { kind: Kind; base: string; uid: string } | null {
  const m = /^(image|video)_(\d{13}_[a-f0-9]{8})(?:_(u[a-f0-9]{10}))?$/.exec(id);
  return m ? { kind: m[1] as Kind, base: m[2], uid: m[3] ?? "" } : null;
}
// Чья задача: "" — владельца, иначе uid пользователя; null — некорректный id
export const jobScope = (id: string): string | null => parseJobId(id)?.uid ?? null;
const scopeRoot = (scope: string) => (scope ? `u/${scope}/jobs/` : "jobs/");
const jobPrefix = (id: string) => {
  const p = parseJobId(id)!;
  return `${scopeRoot(p.uid)}${p.kind}/${p.base}.`;
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
// Превью для сетки галереи: webp до 800 px по большей стороне (оригинал остаётся для просмотра и скачивания)
export async function makeThumb(id: string, index: number, buf: Buffer): Promise<string | undefined> {
  try {
    const sharp = (await import("sharp")).default;
    const out = await sharp(buf, { failOn: "none" }).rotate()
      .resize({ width: 800, height: 800, fit: "inside", withoutEnlargement: true })
      .webp({ quality: 78 }).toBuffer();
    if (out.length >= buf.length) return undefined; // превью не легче оригинала — не нужно
    return await putFile(`out/${id}/${index}.thumb.webp`, out, "image/webp");
  } catch (e) {
    console.warn("thumb failed", (e as Error).message);
    return undefined;
  }
}

async function copyOutput(id: string, index: number, out: JobOutput): Promise<JobOutput> {
  if (out.url.startsWith("/") || out.url.includes(`/out/${id}/`)) return out; // уже в нашем хранилище
  const r = await fetch(out.url, { cache: "no-store" });
  if (!r.ok || !r.body) return out; // оставим исходную ссылку
  const ct = r.headers.get("content-type") || (out.type === "video" ? "video/mp4" : "image/png");
  const pathname = `out/${id}/${index}.${extFrom(ct, out.url, out.type)}`;
  if (out.type === "image") {
    const buf = Buffer.from(await r.arrayBuffer());
    const url = await putFile(pathname, buf, ct);
    return { ...out, url, thumb: await makeThumb(id, index, buf) };
  }
  const url = await putFile(pathname, r.body, ct);
  return { ...out, url };
}

// Догенерация превью для старых результатов (вызывается из галереи постепенно)
export async function ensureThumbs(ids: string[], origin: string): Promise<JobRecord[]> {
  const updated: JobRecord[] = [];
  for (const id of ids.slice(0, 8)) {
    if (!parseJobId(id)) continue;
    const files = await findJobFiles(id);
    if (!files.done) continue;
    const rec = await readJSON<JobRecord>(files.done);
    if (!rec || rec.status !== "completed") continue;
    let changed = false;
    const outputs: JobOutput[] = [];
    for (let i = 0; i < rec.outputs.length; i++) {
      const o = rec.outputs[i];
      if (o.type !== "image" || o.thumb || /\.svg(\?|$)/i.test(o.url)) { outputs.push(o); continue; }
      try {
        const lk = localKeyOf(o.url);
        const buf = lk ? await readLocalFile(lk) : Buffer.from(await (await fetch(toAbsolute(o.url, origin), { cache: "no-store" })).arrayBuffer());
        const thumb = buf ? await makeThumb(id, i, buf) : undefined;
        // «-» — превью не нужно (оригинал и так лёгкий), чтобы не пытаться снова
        outputs.push({ ...o, thumb: thumb ?? "-" });
        changed = true;
      } catch { outputs.push(o); }
    }
    if (changed) {
      const next = { ...rec, outputs };
      await putJSON(donePath(id), next);
      updated.push(next);
    }
  }
  return updated;
}

export const loadInlinePublic = (url: string, origin: string) => loadInline(url, origin);
async function loadInline(url: string, origin: string) {
  const lk = localKeyOf(url);
  if (lk) {
    const buf = await readLocalFile(lk);
    if (!buf) throw new hf.ProviderError("Референс не найден", 400);
    const ext = url.split(".").pop()?.toLowerCase();
    const mimeType = ext === "jpg" || ext === "jpeg" ? "image/jpeg" : ext === "webp" ? "image/webp"
      : ext === "mp4" ? "video/mp4" : ext === "mov" ? "video/quicktime" : ext === "webm" ? "video/webm" : "image/png";
    return { mimeType, data: buf.toString("base64") };
  }
  return fetchAsInline(toAbsolute(url, origin));
}

// BytePlus принимает публичные URL или data URI; локальные файлы (режим разработки) отдаём как data URI
async function toProviderUrl(url: string, origin: string): Promise<string> {
  if (localKeyOf(url)) {
    const inl = await loadInline(url, origin);
    return `data:${inl.mimeType};base64,${inl.data}`;
  }
  return toAbsolute(url, origin);
}

function mockSvg(prompt: string, seed: number, aspect = "3:4"): string {
  const hue = seed % 360;
  const m = /^(\d+):(\d+)$/.exec(aspect);
  const W = m ? Math.round(1024 * Math.sqrt(Number(m[1]) / Number(m[2]))) : 768;
  const H = m ? Math.round(1024 * Math.sqrt(Number(m[2]) / Number(m[1]))) : 1024;
  const safe = prompt.replace(/[<>&"]/g, " ").slice(0, 60);
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
<defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="hsl(${hue},70%,45%)"/><stop offset="1" stop-color="hsl(${(hue + 80) % 360},70%,20%)"/></linearGradient></defs>
<rect width="${W}" height="${H}" fill="url(#g)"/><text x="40" y="${H - 44}" fill="white" font-family="sans-serif" font-size="28" opacity=".85">MOCK · ${safe}</text></svg>`;
}

// Синхронные генерации (Nano Banana, Seedream): сразу пишем запись «в процессе»,
// чтобы карточка не пропадала при перезагрузке страницы или переходе между разделами
const SYNC_TIMEOUT_MS = 330_000;
async function runSync(base: JobRecord, work: () => Promise<Partial<JobRecord>>): Promise<JobRecord> {
  await putJSON(pendingPath(base.id), { ...base, status: "in_progress", providerRequestId: `sync:${base.createdAt}` });
  let rec: JobRecord;
  try {
    rec = { ...base, ...(await work()), finishedAt: Date.now() };
  } catch (e) {
    const where = base.provider === "google" ? "Google Gemini" : base.provider === "byteplus" ? "BytePlus" : "провайдером";
    rec = { ...base, status: "failed", cost: 0, error: describeNetError(e, where).message, finishedAt: Date.now() };
  }
  await putJSON(donePath(base.id), rec);
  await afterDone(rec);
  const files = await findJobFiles(base.id).catch(() => null);
  if (files?.pending) await deleteItems([files.pending]).catch(() => {});
  return rec;
}

export async function createJob(asked: GenRequest, origin: string, who: { uid?: string; ip?: string; souls?: string[] } = {}): Promise<JobRecord> {
  const err = validateRequest(asked);
  if (err) throw new hf.ProviderError(err, 400);
  // Пользователь может брать только своих персонажей Soul ID
  const soulId = asked.params?.custom_reference_id;
  if (who.uid && typeof soulId === "string" && soulId && !(who.souls ?? []).includes(soulId)) {
    throw new hf.ProviderError("Этот Soul ID вам недоступен — создайте своего персонажа", 403);
  }
  // В записи задачи остаётся режим, выбранный в интерфейсе; провайдеру уходит фактический
  const req = resolveRequest(asked);
  const model = getModel(req.modelId)!;
  const mode = getMode(model, asked.modeId);
  const id = newJobId(model.kind, who.uid ?? "");
  const base: JobRecord = {
    id, kind: model.kind, modelId: model.id, modeId: mode.id,
    prompt: (asked.prompt ?? "").trim(), params: asked.params ?? {}, inputs: asked.inputs ?? {},
    cost: estimateCost(asked), provider: MOCK ? "mock" : model.provider,
    status: "queued", outputs: [], createdAt: Date.now(),
    ...(who.uid ? { userId: who.uid } : {}), ...(who.ip ? { ip: who.ip } : {}),
  };

  if (MOCK) {
    if (model.kind === "image") {
      return runSync(base, async () => {
        await new Promise((r) => setTimeout(r, 4000)); // имитация времени генерации
        // Слово mock-block в промпте имитирует отказ модерации (проверка учёта нарушений)
        if (/mock-block/.test(base.prompt)) return { status: "failed", cost: 0, outputs: [], error: "Google: заблокировано (IMAGE_SAFETY)" };
        const n = Number(req.params.count ?? req.params.batch_size ?? 1) || 1;
        const outputs: JobOutput[] = [];
        for (let i = 0; i < n; i++) {
          const url = await putFile(`out/${id}/${i}.svg`, mockSvg(base.prompt, Date.now() + i * 47, String(req.params.aspect_ratio ?? "3:4")), "image/svg+xml");
          outputs.push({ url, type: "image" });
        }
        return { status: "completed", outputs };
      });
    }
    const rec = { ...base, providerRequestId: `mock:${Date.now()}` };
    await putJSON(pendingPath(id), rec);
    return rec;
  }

  if (model.provider === "google" && model.kind === "video") {
    const plan = buildOmniPlan(req);
    const media = await Promise.all(plan.media.map(async (m) => ({ kind: m.kind, ...(await loadInline(m.url, origin)) })));
    const body: Record<string, unknown> = {
      input: media.length
        ? [...media.map((m) => ({ type: m.kind, data: m.data, mime_type: m.mimeType })), ...(plan.text ? [{ type: "text", text: plan.text }] : [])]
        : plan.text,
      response_format: plan.responseFormat,
    };
    if (plan.task) body.generation_config = { video_config: { task: plan.task } };
    const iid = await omniSubmit(body);
    const rec: JobRecord = { ...base, providerRequestId: `omni:${iid}` };
    await putJSON(pendingPath(id), rec);
    return rec;
  }

  if (model.provider === "google") {
    return runSync(base, async () => {
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
        outputs.push({ url, type: "image", thumb: await makeThumb(id, i, img.data) });
      }
      // Платим только за реально полученные картинки
      return { status: "completed", outputs, cost: Math.round((base.cost / count) * images.length * 10000) / 10000 };
    });
  }

  if (model.provider === "byteplus") {
    const arkModel = ark.arkModelId(model.id, ARK_MODEL_IDS[model.id]);
    const conv: Record<string, string[]> = {};
    const { arkInputFor } = await import("./precheck");
    for (const [k, v] of Object.entries(req.inputs ?? {})) {
      conv[k] = await Promise.all((v ?? []).filter(Boolean).map(async (u) =>
        (model.kind === "video" ? await arkInputFor(u, who.uid ?? "") : null) ?? toProviderUrl(u, origin)));
    }
    if (model.kind === "video") {
      const taskId = await ark.seedanceSubmit(buildArkVideoBody({ ...req, inputs: conv }, arkModel));
      const rec: JobRecord = { ...base, providerRequestId: `ark:${taskId}` };
      await putJSON(pendingPath(id), rec);
      return rec;
    }
    return runSync(base, async () => {
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
      return { status: "completed", outputs, cost: Math.round((base.cost / count) * urls.length * 10000) / 10000 };
    });
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
  await afterDone(done);
  return done;
}

// Срабатывания модерации провайдеров у пользователей учитываем (lib/moderation)
async function afterDone(rec: JobRecord) {
  if (!rec.userId || rec.status === "completed" || rec.status === "canceled") return;
  try { await (await import("./moderation")).noteBlocked(rec); }
  catch (e) { console.error("noteBlocked:", (e as Error).message); }
}

// Какой запрос провайдера принадлежит задаче (сверяем, что опрашивают именно её)
export async function storedProviderId(id: string): Promise<string | null> {
  if (!parseJobId(id)) return null;
  const files = await findJobFiles(id);
  const it = files.pending ?? files.done;
  const rec = it ? await readJSON<JobRecord>(it) : null;
  return rec?.providerRequestId ?? null;
}

// Опрос статуса: обращаемся к хранилищу только при завершении, чтобы не тратить операции Blob
export async function pollJob(id: string, providerRequestId: string): Promise<Partial<JobRecord> & { id: string; status: JobStatus }> {
  if (!parseJobId(id)) throw new hf.ProviderError("Некорректный id", 400);
  if (providerRequestId.startsWith("mock:")) {
    const started = Number(providerRequestId.slice(5));
    if (Date.now() - started < 8000) return { id, status: Date.now() - started < 3000 ? "queued" : "in_progress" };
    const done = await finalize(id, { status: "completed", outputs: [{ url: withBase("/mock.mp4"), type: "video" }] });
    return done ?? { id, status: "failed", error: "Задача не найдена" };
  }
  if (providerRequestId.startsWith("sync:")) {
    const files = await findJobFiles(id);
    if (files.done) {
      const d = await readJSON<JobRecord>(files.done);
      if (d) return d;
    }
    if (Date.now() - Number(providerRequestId.slice(5)) < SYNC_TIMEOUT_MS) return { id, status: "in_progress" };
    const done = await finalize(id, { status: "failed", error: "Генерация прервалась — попробуйте ещё раз" });
    return done ?? { id, status: "failed", error: "Генерация прервалась" };
  }
  if (providerRequestId.startsWith("omni:")) {
    const iid = providerRequestId.slice(5);
    const os = await omniStatus(iid);
    if (os.status === "in_progress") return { id, status: "in_progress" };
    if (os.status === "completed" && os.video) {
      const buf = os.video.data ? Buffer.from(os.video.data, "base64") : await omniDownload(os.video.uri!);
      const url = await putFile(`out/${id}/0.mp4`, buf, os.video.mimeType || "video/mp4");
      const done = await finalize(id, { status: "completed", outputs: [{ url, type: "video" }] });
      omniDelete(iid).catch(() => {});
      return done ?? { id, status: "completed", outputs: [{ url, type: "video" }] };
    }
    const st3: JobStatus = os.status === "canceled" ? "canceled" : "failed";
    const done = await finalize(id, { status: st3, outputs: [], error: os.error });
    return done ?? { id, status: st3, error: os.error };
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
  if (providerRequestId.startsWith("mock:") || providerRequestId.startsWith("sync:")) return;
  if (providerRequestId.startsWith("ark:")) { await ark.seedanceCancel(providerRequestId.slice(4)); return; }
  if (providerRequestId.startsWith("omni:")) { await omniCancel(providerRequestId.slice(5)); return; }
  await hf.cancel(providerRequestId);
}

// Готовые задачи почти не меняются: кэшируем в памяти функции по пути и размеру файла
// (правка записи меняет размер — тогда читаем заново)
const doneCache = new Map<string, JobRecord>();
async function readJobCached(item: StoredItem): Promise<JobRecord | null> {
  const cacheable = item.pathname.endsWith(".d.json") && item.size !== undefined;
  const key = `${item.pathname}:${item.size}`;
  if (cacheable) {
    const hit = doneCache.get(key);
    if (hit) return hit;
  }
  const rec = await readJSON<JobRecord>(item);
  if (rec && cacheable) {
    if (doneCache.size > 5000) doneCache.delete(doneCache.keys().next().value!);
    doneCache.set(key, rec);
  }
  return rec;
}

export async function listJobs(kind: Kind, cursor?: string, scope = ""): Promise<{ jobs: JobRecord[]; cursor?: string }> {
  const { items, cursor: next } = await listItems(`${scopeRoot(scope)}${kind}/`, 40, cursor);
  const byBase = new Map<string, StoredItem>();
  for (const it of items) {
    const base = it.pathname.replace(/\.(p|d)\.json$/, "");
    const prev = byBase.get(base);
    if (!prev || it.pathname.endsWith(".d.json")) byBase.set(base, it);
  }
  const jobs = (await Promise.all([...byBase.values()].map((i) => readJobCached(i)))).filter(Boolean) as JobRecord[];
  jobs.sort((a, b) => b.createdAt - a.createdAt);
  return { jobs, cursor: next };
}

export async function deleteJob(id: string): Promise<void> {
  if (!parseJobId(id)) throw new hf.ProviderError("Некорректный id", 400);
  const a = await listItems(jobPrefix(id), 10);
  const b = await listItems(`out/${id}/`, 20);
  await deleteItems([...a.items, ...b.items]);
}

// Удаление части результатов задачи (если удаляются все — удаляется задача целиком)
export async function removeOutputs(id: string, indexes?: number[]): Promise<"deleted" | "updated" | "skipped"> {
  if (!parseJobId(id)) throw new hf.ProviderError("Некорректный id", 400);
  const files = await findJobFiles(id);
  if (!files.done) {
    if (files.pending) return "skipped"; // ещё генерируется
    await deleteJob(id);
    return "deleted";
  }
  const rec = await readJSON<JobRecord>(files.done);
  const drop = new Set(indexes ?? []);
  if (!rec || !indexes || !rec.outputs.length || rec.outputs.every((_, i) => drop.has(i))) {
    await deleteJob(id);
    return "deleted";
  }
  const { items } = await listItems(`out/${id}/`, 20);
  const dropUrls = new Set(rec.outputs.filter((_, i) => drop.has(i)).flatMap((o) => [o.url, ...(o.thumb && o.thumb !== "-" ? [o.thumb] : [])]));
  await deleteItems(items.filter((it) => dropUrls.has(it.url)));
  await putJSON(donePath(id), { ...rec, outputs: rec.outputs.filter((_, i) => !drop.has(i)) });
  return "updated";
}
