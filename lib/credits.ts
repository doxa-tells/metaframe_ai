// Кредиты MetaFrame: сколько списывается за генерацию (общий код для клиента и сервера).
// Seedance (BytePlus) — ровно как у Higgsfield; Nano Banana 2K — 2 кредита ради паритета;
// остальное — от себестоимости API так, чтобы кредит стоил нам не дороже CREDIT_COST_CAP.
import { getModel, type GenRequest } from "./models";

export const CREDIT_COST_CAP = 0.0239; // USD себестоимости на кредит ≈ 40% маржи на цене пакета Pro
const FX_SPREAD = 1.015;              // конвертация при оплате провайдеров
const SEEDANCE_PER_SEC: Record<string, number> = { "480p": 3, "720p": 7, "1080p": 16 };

const round2 = (n: number) => Math.round(n * 100) / 100;

export function creditsFor(req: GenRequest): number {
  const model = getModel(req.modelId);
  if (!model) return 0;
  const p = req.params ?? {};
  if (model.id === "seedance-2.5") return (SEEDANCE_PER_SEC[String(p.resolution ?? "720p")] ?? 7) * Number(p.duration ?? 5);
  if (model.id === "nano-banana-2.1" && String(p.image_size ?? "2K") === "2K") return 2 * Number(p.count ?? 1);
  const usd = model.price(req.modeId, p);
  if (!usd) return 0;
  const step = model.kind === "image" ? 0.25 : 1;
  return round2(Math.max(step, Math.ceil((usd * FX_SPREAD) / CREDIT_COST_CAP / step - 1e-9) * step));
}

export function formatCredits(n: number): string {
  const v = round2(n);
  return v.toLocaleString("ru-RU", { maximumFractionDigits: 2 });
}

// «кредит / кредита / кредитов»
export function creditsWord(n: number): string {
  if (!Number.isInteger(n)) return "кредита";
  const a = Math.abs(n) % 100, b = a % 10;
  if (a > 10 && a < 20) return "кредитов";
  if (b === 1) return "кредит";
  if (b >= 2 && b <= 4) return "кредита";
  return "кредитов";
}
