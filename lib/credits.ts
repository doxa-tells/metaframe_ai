// Кредиты MetaFrame: сколько списывается за генерацию (общий код для клиента и сервера).
//
// Экономика (пересчёт 26.11.2026). Кредит продаётся от 20 ₸ (пакет Pro), 21 ₸ (Plus) и 25 ₸ (Hobby).
// Провайдеры берут доллары, поэтому считаем по осторожному курсу 480 ₸/$ (сегодня 460): кредит Pro = $0.0417.
// Правило: генерация приносит не меньше 20% маржи на самом дешёвом кредите — себестоимость на кредит
// не выше CREDIT_COST_CAP. Исключения — там, где держим цену Higgsfield (у них кредит стоит $0.043–0.049):
//   Seedance 2.5 — 3 / 7 / 16 кредитов в секунду, как у Higgsfield (маржа 13–20% на Pro);
//   Nano Banana 2.1 в 2K — 2 кредита, как у Higgsfield.
// Модели, которые Higgsfield продаёт дешевле собственного API (Kling, Genjutsu, Nano Banana Pro), дешевле них
// продавать нельзя: там цена — себестоимость плюс 20%.
import { getModel, refVideoSeconds, type GenRequest } from "./models";

export const CREDIT_USD = 20 / 480;                 // выручка с кредита на пакете Pro
export const MIN_MARGIN = 0.2;
export const CREDIT_COST_CAP = CREDIT_USD * (1 - MIN_MARGIN); // $0.0333 себестоимости на кредит
const FX_SPREAD = 1.015;                            // конвертация при оплате провайдеров

// Seedance: кредитов за секунду результата; с видео-референсами — за секунду референсов и результата вместе
// (BytePlus считает токены за те и другие, по сниженному тарифу), но не меньше цены без видео
const SEEDANCE: Record<string, { plain: Record<string, number>; video: Record<string, number> }> = {
  "seedance-2.5": { plain: { "480p": 3, "720p": 7, "1080p": 16 }, video: { "480p": 2, "720p": 4.25, "1080p": 10.5 } },
  "seedance-2.5-flash": { plain: { "480p": 2, "720p": 5 }, video: { "480p": 1.25, "720p": 3 } },
};

// Цена Higgsfield за изображение в кредитах. Если наша формула выходит дороже — берём их цену,
// пока маржа на пакете Pro остаётся не ниже 12% по осторожному курсу (16–18% по курсу 460 ₸/$), иначе — минимальная цена с такой маржой
const HF_IMAGE: Record<string, number> = { "seedream-5.0-lite": 1, "seedream-5.0-pro": 2.5, "seedream-5.0-flash": 0.5 };
const PARITY_MARGIN = 0.12;

const round2 = (n: number) => Math.round(n * 100) / 100;

export function creditsFor(req: GenRequest): number {
  const model = getModel(req.modelId);
  if (!model) return 0;
  const p = req.params ?? {};
  const sd = SEEDANCE[model.id];
  if (sd) {
    const res = String(p.resolution ?? "720p");
    const out = Number(p.duration ?? 5);
    const plain = (sd.plain[res] ?? sd.plain["720p"]) * out;
    const vin = refVideoSeconds(p);
    return vin ? Math.max(plain, Math.ceil((sd.video[res] ?? sd.video["720p"]) * (vin + out) - 1e-9)) : plain;
  }
  if (model.id === "nano-banana-2.1" && String(p.image_size ?? "2K") === "2K") return 2 * Number(p.count ?? 1);
  const usd = model.price(req.modeId, p, req.inputs);
  if (!usd) return 0;
  const step = model.kind === "image" ? 0.25 : 1;
  const up = (cap: number) => Math.max(step, Math.ceil((usd * FX_SPREAD) / cap / step - 1e-9) * step);
  let credits = up(CREDIT_COST_CAP);
  const hf = HF_IMAGE[model.id];
  if (hf) credits = Math.min(credits, Math.max(hf * Number(p.count ?? 1), up(CREDIT_USD * (1 - PARITY_MARGIN))));
  return round2(credits);
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
