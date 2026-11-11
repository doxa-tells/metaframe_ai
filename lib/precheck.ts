import "server-only";
import { createHash } from "node:crypto";
import { getModel } from "./models";
import { listItems, putJSON, readJSON, localKeyOf, deleteItems, type StoredItem } from "./storage";
import { MOCK } from "./jobs";
import { ArkAssetError, assetStatus, assetsConfigured, createAsset, pruneOldest } from "./providers/arkAssets";
import { LIMITS, overQuota } from "./usage";
import { ProviderError } from "./providers/higgsfield";

// Проверка референса для Seedance — так же, как у Higgsfield: файл загружается в личную библиотеку
// ассетов BytePlus. Прошёл (Active) — в генерацию уходит доверенная ссылка asset://ID, и Seedance
// принимает даже фотореалистичное ИИ-лицо. Не прошёл (Failed) — реф сразу не пропускаем.
// Генерация не запускается, деньги не списываются.
export type PrecheckResult = {
  ok: boolean; reason?: string; at: number; fp?: string;
  assetId?: string; status?: "Processing" | "Active" | "Failed";
  skipped?: boolean; skipReason?: string; retryAfter?: number;
};

// У каждого пользователя своя библиотека ассетов (как требует BytePlus) и свой кэш проверок
const pathOf = (url: string, scope: string) => `precheck/seedance/${createHash("sha1").update(scope ? `${scope}|${url}` : url).digest("hex")}.json`;
const groupOf = (scope: string) => (scope ? `MetaFrame ${scope}` : undefined);

async function readRec(url: string, scope: string): Promise<{ path: string; rec: PrecheckResult | null; item?: StoredItem }> {
  const path = pathOf(url, scope);
  const { items } = await listItems(path, 1);
  const it = items.find((i) => i.pathname === path);
  return { path, rec: it ? await readJSON<PrecheckResult>(it) : null, item: it };
}
const dropRec = async (item?: StoredItem) => { if (item) await deleteItems([item]).catch(() => {}); };

const FAIL_TEXT = "BytePlus не пропустил реф: похоже на реального человека, чужого персонажа или запрещённый контент";
const isThrottle = (e: unknown) => e instanceof ArkAssetError && (e.status === 429 || /Limit(Exceeded)?|Throttl|TooMany|FlowLimit/i.test(e.code ?? "")) && !/Quota/i.test(e.code ?? "");
const isQuota = (e: unknown) => e instanceof ArkAssetError && /Quota|Exceed.*(Asset|Capacity)|Capacity/i.test(`${e.code} ${e.message}`);

const NO_SUB = "Проверка рефов через библиотеку BytePlus доступна только на платной подписке Advanced/Premium в ModelArk. Для рефов с лицами переключитесь на «Seedance 2.5 · Higgsfield»";
const isNoSubscription = (e: unknown) => e instanceof ArkAssetError && /SubscriptionRequired/i.test(`${e.code} ${e.message}`);
let noSubscriptionUntil = 0;

// Отпечаток содержимого: размер + sha256 первых 1 МБ. Один и тот же файл, загруженный заново
// (другая ссылка), не отправляется в BytePlus повторно
async function fingerprint(url: string, kind: string): Promise<string | null> {
  try {
    const r = await fetch(url, { headers: { Range: "bytes=0-1048575" }, cache: "no-store", signal: AbortSignal.timeout(15_000) });
    if (!r.ok || !r.body) return null;
    const total = /\/(\d+)$/.exec(r.headers.get("content-range") ?? "")?.[1] ?? r.headers.get("content-length") ?? "?";
    const reader = r.body.getReader();
    const h = createHash("sha256").update(`${kind}|${total}|`);
    let n = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      const take = value.subarray(0, Math.max(0, 1048576 - n));
      h.update(take);
      n += take.length;
      if (n >= 1048576) { await reader.cancel().catch(() => {}); break; }
    }
    return h.digest("hex").slice(0, 40);
  } catch { return null; }
}
// Вердикт «не прошёл» общий для всех (тот же файл не пропустят никому), «прошёл» — только внутри своей библиотеки
const fpPath = (fp: string, scope: string) => `precheck/seedance/fp/${scope || "owner"}/${fp}.json`;
const fpFailPath = (fp: string) => `precheck/seedance/fp-failed/${fp}.json`;
async function readAt(p: string): Promise<PrecheckResult | null> {
  const { items } = await listItems(p, 1);
  const it = items.find((i) => i.pathname === p);
  return it ? readJSON<PrecheckResult>(it) : null;
}

// Лимит BytePlus на создание ассетов (Entry: 3 в минуту) соблюдаем сами — общий счётчик для всех копий функции,
// чтобы не ловить ошибку лимита и не тратить попытки впустую. ARK_ASSET_QPM — если тариф выше
const createQpm = () => { const n = Number(process.env.ARK_ASSET_QPM); return Number.isFinite(n) && n > 0 ? n : 3; };
let throttledUntil = 0;
const waitSec = () => Math.max(5, Math.ceil((60_000 - (Date.now() % 60_000)) / 1000) + Math.floor(Math.random() * 5));

const verdict = (assetId: string, st: { status: string; reason?: string }): PrecheckResult =>
  st.status === "Active" ? { ok: true, assetId, status: "Active", at: Date.now() }
  : st.status === "Failed" ? { ok: false, assetId, status: "Failed", reason: st.reason ? `${FAIL_TEXT} (${st.reason})` : FAIL_TEXT, at: Date.now() }
  : { ok: true, assetId, status: "Processing", at: Date.now(), retryAfter: 8 };

export async function precheckSeedance(modelId: string, url: string, kind: "image" | "video", _origin: string, scope = ""): Promise<PrecheckResult> {
  const model = getModel(modelId);
  if (!model || model.provider !== "byteplus" || model.kind !== "video") return { ok: true, at: Date.now(), skipped: true };
  const { path, rec, item } = await readRec(url, scope);

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

  if (rec?.status === "Active" || rec?.status === "Failed") return { ...rec, retryAfter: undefined };
  // Библиотека ассетов доступна только на платной подписке BytePlus — не дёргаем API зря
  if (noSubscriptionUntil > Date.now()) return { ok: true, at: Date.now(), skipped: true, skipReason: NO_SUB };

  // Уже создан и ещё проверяется: один дешёвый запрос статуса (общий ListAssets), без ожидания в цикле
  if (rec?.assetId) {
    if (Date.now() - rec.at < 5_000) return { ...rec, retryAfter: 6 };
    const st = await assetStatus(rec.assetId).catch((e) => { if (isThrottle(e)) return null; throw e; });
    if (!st) return { ...rec, retryAfter: 15 };
    if (st.status === "Missing") { await dropRec(item); return { ok: false, retryAfter: 1, at: Date.now() }; }
    const res = verdict(rec.assetId, st);
    await putJSON(path, { ...res, retryAfter: undefined });
    if (res.status !== "Processing" && rec.fp) {
      await putJSON(res.status === "Failed" ? fpFailPath(rec.fp) : fpPath(rec.fp, scope), { ...res, retryAfter: undefined }).catch(() => {});
    }
    return res;
  }

  // Тот же файл уже проверяли (под другой ссылкой) — берём готовый вердикт
  const fp = await fingerprint(url, kind);
  if (fp) {
    const known = (await readAt(fpFailPath(fp))) ?? (await readAt(fpPath(fp, scope)));
    if (known && (known.status === "Active" || known.status === "Failed")) {
      await putJSON(path, { ...known, fp });
      return known;
    }
  }

  if (throttledUntil > Date.now()) return { ok: false, retryAfter: Math.ceil((throttledUntil - Date.now()) / 1000) + 2, at: Date.now() };
  if (scope && (await overQuota(`precheck:${scope}`, LIMITS.precheckPerHour(), 3_600_000))) {
    return { ok: true, at: Date.now(), skipped: true, skipReason: "Слишком много проверок рефов за час — Seedance проверит реф сам при генерации" };
  }
  if (await overQuota("ark:create-asset", createQpm(), 60_000)) return { ok: false, retryAfter: waitSec(), at: Date.now() };

  let assetId: string;
  const name = `ref ${new Date().toISOString().slice(0, 16)}`;
  try {
    assetId = await createAsset(url, kind, name, groupOf(scope));
  } catch (e) {
    if (isNoSubscription(e)) { noSubscriptionUntil = Date.now() + 10 * 60_000; return { ok: true, at: Date.now(), skipped: true, skipReason: NO_SUB }; }
    if (isThrottle(e)) { throttledUntil = Date.now() + 20_000; return { ok: false, retryAfter: 22, at: Date.now() }; }
    if (!isQuota(e)) throw e;
    // Место в библиотеке закончилось — удаляем самые старые наши ассеты и пробуем ещё раз
    await pruneOldest(10);
    assetId = await createAsset(url, kind, name, groupOf(scope));
  }
  // Первую проверку статуса делаем через несколько секунд — обычно BytePlus успевает за 5–20 с
  const res: PrecheckResult = { ok: true, assetId, status: "Processing", at: Date.now(), ...(fp ? { fp } : {}) };
  await putJSON(path, res);
  return { ...res, retryAfter: 6 };
}

// Во время генерации: проверенный реф заменяем доверенной ссылкой asset://ID
export async function arkInputFor(url: string, scope = ""): Promise<string | null> {
  if (MOCK || !assetsConfigured()) return null;
  const { path, rec, item } = await readRec(url, scope);
  if (!rec?.assetId) return null;
  if (rec.status === "Failed") throw new ProviderError(rec.reason ?? FAIL_TEXT, 400);
  if (rec.status === "Active") return `asset://${rec.assetId}`;
  const st = await assetStatus(rec.assetId);
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
