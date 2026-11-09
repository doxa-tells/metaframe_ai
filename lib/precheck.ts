import "server-only";
import { createHash } from "node:crypto";
import { getModel } from "./models";
import { listItems, putJSON, readJSON, localKeyOf, deleteItems, type StoredItem } from "./storage";
import { MOCK } from "./jobs";
import { ArkAssetError, assetsConfigured, createAsset, getAsset, pruneOldest } from "./providers/arkAssets";
import { ProviderError } from "./providers/higgsfield";

// Проверка референса для Seedance — так же, как у Higgsfield: файл загружается в личную библиотеку
// ассетов BytePlus. Прошёл (Active) — в генерацию уходит доверенная ссылка asset://ID, и Seedance
// принимает даже фотореалистичное ИИ-лицо. Не прошёл (Failed) — реф сразу не пропускаем.
// Генерация не запускается, деньги не списываются.
export type PrecheckResult = {
  ok: boolean; reason?: string; at: number;
  assetId?: string; status?: "Processing" | "Active" | "Failed";
  skipped?: boolean; skipReason?: string; retryAfter?: number;
};

const pathOf = (url: string) => `precheck/seedance/${createHash("sha1").update(url).digest("hex")}.json`;

async function readRec(url: string): Promise<{ path: string; rec: PrecheckResult | null; item?: StoredItem }> {
  const path = pathOf(url);
  const { items } = await listItems(path, 1);
  const it = items.find((i) => i.pathname === path);
  return { path, rec: it ? await readJSON<PrecheckResult>(it) : null, item: it };
}
const dropRec = async (item?: StoredItem) => { if (item) await deleteItems([item]).catch(() => {}); };

const FAIL_TEXT = "BytePlus не пропустил реф: похоже на реального человека, чужого персонажа или запрещённый контент";
const isThrottle = (e: unknown) => e instanceof ArkAssetError && (e.status === 429 || /Limit(Exceeded)?|Throttl|TooMany|FlowLimit/i.test(e.code ?? "")) && !/Quota/i.test(e.code ?? "");
const isQuota = (e: unknown) => e instanceof ArkAssetError && /Quota|Exceed.*(Asset|Capacity)|Capacity/i.test(`${e.code} ${e.message}`);

async function pollUntilDone(assetId: string, ms: number) {
  const until = Date.now() + ms;
  let st = await getAsset(assetId);
  while (st.status === "Processing" && Date.now() < until) {
    await new Promise((r) => setTimeout(r, 3000));
    st = await getAsset(assetId);
  }
  return st;
}

export async function precheckSeedance(modelId: string, url: string, kind: "image" | "video", _origin: string): Promise<PrecheckResult> {
  const model = getModel(modelId);
  if (!model || model.provider !== "byteplus" || model.kind !== "video") return { ok: true, at: Date.now(), skipped: true };
  const { path, rec, item } = await readRec(url);

  if (MOCK) {
    if (rec) return rec;
    await new Promise((r) => setTimeout(r, 700));
    const res: PrecheckResult = /face|лицо|person/i.test(url)
      ? { ok: false, reason: FAIL_TEXT, status: "Failed", at: Date.now() }
      : { ok: true, assetId: "mock-asset", status: "Active", at: Date.now() };
    await putJSON(path, res);
    return res;
  }

  // Без ключей IAM проверить заранее нечем — Seedance проверит сам при генерации (это бесплатно)
  if (!assetsConfigured()) return { ok: true, at: Date.now(), skipped: true, skipReason: "Предпроверка выключена: в Vercel не видны BYTEPLUS_ACCESS_KEY и BYTEPLUS_SECRET_KEY (проверьте имена и сделайте Redeploy)" };
  if (localKeyOf(url)) return { ok: true, at: Date.now(), skipped: true, skipReason: "Локальный файл — BytePlus не может его скачать" };

  if (rec?.status === "Active" || rec?.status === "Failed") return rec;

  let assetId = rec?.assetId;
  if (!assetId) {
    try {
      assetId = await createAsset(url, kind, `ref ${new Date().toISOString().slice(0, 16)}`);
    } catch (e) {
      if (isThrottle(e)) return { ok: false, retryAfter: 20, at: Date.now() };
      if (!isQuota(e)) throw e;
      // Место в библиотеке закончилось — удаляем самые старые наши ассеты и пробуем ещё раз
      await pruneOldest(10);
      assetId = await createAsset(url, kind, `ref ${new Date().toISOString().slice(0, 16)}`);
    }
    await putJSON(path, { ok: true, assetId, status: "Processing", at: Date.now() } satisfies PrecheckResult);
  }

  const st = await pollUntilDone(assetId, 45_000);
  const res: PrecheckResult =
    st.status === "Active" ? { ok: true, assetId, status: "Active", at: Date.now() }
    : st.status === "Failed" ? { ok: false, assetId, status: "Failed", reason: st.reason ? `${FAIL_TEXT} (${st.reason})` : FAIL_TEXT, at: Date.now() }
    : st.status === "Missing" ? { ok: false, retryAfter: 1, at: Date.now() }
    : { ok: true, assetId, status: "Processing", at: Date.now() };
  if (st.status === "Missing") await dropRec(item);
  else await putJSON(path, res);
  return res;
}

// Во время генерации: проверенный реф заменяем доверенной ссылкой asset://ID
export async function arkInputFor(url: string): Promise<string | null> {
  if (MOCK || !assetsConfigured()) return null;
  const { path, rec, item } = await readRec(url);
  if (!rec?.assetId) return null;
  if (rec.status === "Failed") throw new ProviderError(rec.reason ?? FAIL_TEXT, 400);
  if (rec.status === "Active") return `asset://${rec.assetId}`;
  const st = await getAsset(rec.assetId);
  if (st.status === "Active") { await putJSON(path, { ...rec, status: "Active", at: Date.now() }); return `asset://${rec.assetId}`; }
  if (st.status === "Failed") {
    const reason = st.reason ? `${FAIL_TEXT} (${st.reason})` : FAIL_TEXT;
    await putJSON(path, { ...rec, ok: false, status: "Failed", reason, at: Date.now() });
    throw new ProviderError(reason, 400);
  }
  if (st.status === "Missing") { await dropRec(item); return null; }
  throw new ProviderError("Референс ещё проверяется BytePlus — подождите несколько секунд и повторите", 409);
}

// Диагностика: видны ли ключи и отвечает ли библиотека ассетов (без секретов в ответе)
export async function precheckDiagnostics() {
  const { assetsConfigured: has, ensureGroup, ARK_PROJECT } = await import("./providers/arkAssets");
  const out: Record<string, unknown> = {
    keys: has(),
    accessKeyPrefix: (process.env.BYTEPLUS_ACCESS_KEY ?? "").trim().slice(0, 4) || null,
    host: process.env.BYTEPLUS_OPENAPI_HOST || "ark.ap-southeast-1.byteplusapi.com",
    region: process.env.BYTEPLUS_REGION || "ap-southeast-1",
    project: ARK_PROJECT(),
  };
  if (!has()) return out;
  try { out.group = await ensureGroup(); out.ok = true; }
  catch (e) { out.ok = false; out.error = (e as Error).message; }
  return out;
}
