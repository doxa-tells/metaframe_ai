import "server-only";
import { createHash, createHmac } from "node:crypto";
import { ProviderError } from "./higgsfield";

// Личная библиотека ассетов ModelArk (то, чем пользуются Higgsfield и другие площадки).
// Картинка загружается в группу AIGC («виртуальные персонажи»), BytePlus сам её проверяет:
// Active — Seedance примет её как доверенный реф по ссылке asset://ID (даже фотореалистичное ИИ-лицо),
// Failed — не пропустит. Генерация при этом не запускается и ничего не стоит.
// Управление ассетами — только по ключам IAM (Access Key + Secret Key), это не тот же ключ, что ARK_API_KEY.
const AK = () => process.env.BYTEPLUS_ACCESS_KEY?.trim() ?? "";
const SK = () => process.env.BYTEPLUS_SECRET_KEY?.trim() ?? "";
const HOST = () => (process.env.BYTEPLUS_OPENAPI_HOST || "ark.ap-southeast-1.byteplusapi.com").replace(/^https?:\/\//, "").replace(/\/$/, "");
const REGION = () => process.env.BYTEPLUS_REGION || "ap-southeast-1";
export const ARK_PROJECT = () => process.env.BYTEPLUS_PROJECT || "default";
export const assetsConfigured = () => Boolean(AK() && SK());

const sha256 = (b: string | Buffer) => createHash("sha256").update(b).digest("hex");
const hmac = (k: Buffer | string, v: string) => createHmac("sha256", k).update(v).digest();
const q = (v: string) => encodeURIComponent(v).replace(/[!'()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);

// Подпись BytePlus OpenAPI V4 (HMAC-SHA256)
export function sign(action: string, payload: string, now = new Date()) {
  const xDate = now.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
  const short = xDate.slice(0, 8);
  const query: Record<string, string> = { Action: action, Version: "2024-01-01" };
  const canonicalQuery = Object.keys(query).sort().map((k) => `${q(k)}=${q(query[k])}`).join("&");
  const bodyHash = sha256(payload);
  const headers: Record<string, string> = { "content-type": "application/json", host: HOST(), "x-content-sha256": bodyHash, "x-date": xDate };
  const names = Object.keys(headers).sort();
  const canonical = ["POST", "/", canonicalQuery, names.map((n) => `${n}:${headers[n].trim()}\n`).join(""), names.join(";"), bodyHash].join("\n");
  const scope = `${short}/${REGION()}/ark/request`;
  const toSign = ["HMAC-SHA256", xDate, scope, sha256(canonical)].join("\n");
  let key: Buffer = hmac(SK(), short);
  for (const part of [REGION(), "ark", "request"]) key = hmac(key, part);
  const signature = createHmac("sha256", key).update(toSign).digest("hex");
  return {
    url: `https://${HOST()}/?${canonicalQuery}`,
    headers: {
      "Content-Type": "application/json", "X-Date": xDate, "X-Content-Sha256": bodyHash,
      Authorization: `HMAC-SHA256 Credential=${AK()}/${scope}, SignedHeaders=${names.join(";")}, Signature=${signature}`,
    },
  };
}

export class ArkAssetError extends ProviderError {
  constructor(message: string, status: number, public code?: string) { super(message, status); }
}

async function call(action: string, body: Record<string, unknown>): Promise<Record<string, unknown>> {
  if (!assetsConfigured()) throw new ArkAssetError("Не заданы BYTEPLUS_ACCESS_KEY / BYTEPLUS_SECRET_KEY", 400);
  const payload = JSON.stringify(body);
  const { url, headers } = sign(action, payload);
  const res = await fetch(url, { method: "POST", headers, body: payload, cache: "no-store" });
  const json = (await res.json().catch(() => null)) as Record<string, unknown> | null;
  const err = (json?.ResponseMetadata as Record<string, unknown> | undefined)?.Error as { Code?: string; Message?: string } | undefined;
  if (!res.ok || err?.Code) {
    const code = err?.Code ?? String(res.status);
    throw new ArkAssetError(`BytePlus ассеты ${action}: ${code}${err?.Message ? ` — ${err.Message}` : ""}`, res.status >= 400 ? res.status : 400, code);
  }
  return (json?.Result as Record<string, unknown>) ?? {};
}

// Группа ассетов: общая у владельца, отдельная у каждого пользователя («MetaFrame u…»)
const GROUP_NAME = "MetaFrame refs";
const groupIds = new Map<string, string>();
export async function ensureGroup(name = GROUP_NAME): Promise<string> {
  const known = groupIds.get(name);
  if (known) return known;
  const list = await call("ListAssetGroups", { Filter: { GroupType: "AIGC", Name: name }, MaxResults: 20, ProjectName: ARK_PROJECT() });
  const found = ((list.Items ?? []) as { Id?: string; Name?: string }[]).find((g) => g.Name === name && g.Id);
  if (found?.Id) { groupIds.set(name, found.Id); return found.Id; }
  const created = await call("CreateAssetGroup", { Name: name, Description: name === GROUP_NAME ? "Референсы из MetaFrame Studio" : `Референсы пользователя MetaFrame Studio (${name.slice(10)})`, GroupType: "AIGC", ProjectName: ARK_PROJECT() });
  groupIds.set(name, String(created.Id));
  return String(created.Id);
}

export type AssetState = { id: string; status: "Processing" | "Active" | "Failed" | "Missing"; reason?: string };

export async function createAsset(url: string, kind: "image" | "video", name: string, group?: string): Promise<string> {
  const gid = await ensureGroup(group);
  const r = await call("CreateAsset", { GroupId: gid, URL: url, AssetType: kind === "video" ? "Video" : "Image", Name: name.slice(0, 60), ProjectName: ARK_PROJECT() });
  const id = String(r.Id ?? "");
  if (!id) throw new ArkAssetError("BytePlus не вернул id ассета", 502);
  return id;
}

export async function getAsset(id: string): Promise<AssetState> {
  try {
    const r = await call("GetAsset", { Id: id, ProjectName: ARK_PROJECT() });
    const status = String(r.Status ?? "Processing") as AssetState["status"];
    // Причина отказа приходит в разных полях — берём первую понятную строку
    const reasonSrc = [r.FailedReason, r.FailReason, r.Reason, r.Message, (r.Moderation as Record<string, unknown> | undefined)?.Reason]
      .find((x) => typeof x === "string" && x.trim());
    return { id, status, reason: reasonSrc as string | undefined };
  } catch (e) {
    if (e instanceof ArkAssetError && (e.status === 404 || /NotFound/i.test(e.code ?? ""))) return { id, status: "Missing" };
    throw e;
  }
}

// Удалить самые старые наши ассеты (бесплатный тариф — 50 штук на аккаунт)
// Лимит общий на аккаунт, поэтому чистим самые старые из всех наших групп
export async function pruneOldest(count: number): Promise<number> {
  const r = await call("ListAssets", { Filter: { GroupType: "AIGC" }, MaxResults: 100, SortBy: "CreateTime", SortOrder: "Asc", ProjectName: ARK_PROJECT() });
  const items = ((r.Items ?? []) as { Id?: string }[]).filter((x) => x.Id).slice(0, count);
  let n = 0;
  for (const it of items) { try { await call("DeleteAsset", { Id: it.Id, ProjectName: ARK_PROJECT() }); n++; } catch { /* дальше */ } }
  return n;
}
