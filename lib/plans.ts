// Лимиты по пакету (общий код для клиента и сервера).
// Пакет пользователя — последний начисленный в админке; владелец может поменять его вручную.
// Цифры одновременных генераций — на уровне Higgsfield, Kling и Krea: 2 / 4 / 8 видео и 4 / 8 / 8 картинок.
import type { Kind } from "./models";

export type PlanId = "hobby" | "plus" | "pro";
export type PlanLimits = { video: number; image: number; dailyCredits: number };

export const PLAN_LIMITS: Record<PlanId, PlanLimits> = {
  hobby: { video: 2, image: 4, dailyCredits: 200 },
  plus: { video: 4, image: 8, dailyCredits: 1000 },
  pro: { video: 8, image: 8, dailyCredits: 2000 },
};
export const PLAN_NAMES: Record<PlanId, string> = { hobby: "Hobby", plus: "Plus", pro: "Pro" };
export const PLAN_IDS: PlanId[] = ["hobby", "plus", "pro"];
export const isPlanId = (x: unknown): x is PlanId => typeof x === "string" && (PLAN_IDS as string[]).includes(x);

// Кредиты без пакета (подарок, ручная корректировка) считаются как Hobby
export const planOrDefault = (p: PlanId | undefined | null): PlanId => (p && isPlanId(p) ? p : "hobby");
export const concurrencyOf = (plan: PlanId, kind: Kind): number => PLAN_LIMITS[plan][kind];

// Пакет по размеру начисления: 3000 → Pro, 1000 → Plus, 200 → Hobby (меньше — не пакет)
export function planByCredits(credits: number): PlanId | null {
  if (credits >= 3000) return "pro";
  if (credits >= 1000) return "plus";
  if (credits >= 200) return "hobby";
  return null;
}

// Частота запросов одного пользователя
export const RATE = {
  generatePerMin: 10,   // запусков генерации в минуту
  uploadsPerMin: 30,    // загрузок в минуту (в сутки — USER_UPLOADS_DAILY)
  chatPerMin: 10,       // сообщений ассистенту в минуту (в сутки — USER_CHAT_DAILY)
  chatMaxChars: 200_000, // размер одного запроса к ассистенту: все сообщения и инструкции вместе
  chatMaxImages: 8,     // картинок в одном сообщении
};
