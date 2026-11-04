import { withBase } from "./base";
// Хромовые картинки интерфейса (public/assets)
export const asset = (name: string) => withBase(`/assets/${name}.webp`);

// Эмблема компании-разработчика модели
export function emblemFor(modelId: string): string {
  if (modelId.startsWith("nano-banana") || modelId.startsWith("gemini")) return asset("emblem-google");
  if (modelId.startsWith("seed")) return asset("emblem-seed");
  if (modelId.startsWith("kling")) return asset("emblem-kling");
  return asset("emblem-higgsfield");
}

// Залитая белая эмблема — для ярких фонов (баннер карточки модели)
export function emblemWhiteFor(modelId: string): string {
  return emblemFor(modelId).replace(".webp", "-white.webp");
}

// Иконка режима видео: текст / кадр / референсы
export function modeIcon(modeId: string): string {
  if (modeId === "image") return asset("icon-mode-frame");
  if (modeId === "text") return asset("icon-mode-text");
  return asset("icon-mode-ref");
}

// Баннер карточки модели: свой (если файл уже есть), под ним — общий запасной.
// Возвращает готовое значение для background-image (несколько слоёв).
const HERO: Record<string, string> = {
  "kling": "hero-kling", "seedance": "hero-seedance", "genjutsu-light": "hero-genjutsu",
  "genjutsu": "hero-genjutsu", "gemini-omni": "hero-omni",
};
export function heroFor(modelId: string): string {
  const key = Object.keys(HERO).sort((a, b) => b.length - a.length).find((k) => modelId.startsWith(k));
  const own = key ? asset(HERO[key]) : null;
  const fallback = modelId.startsWith("kling") ? asset("hero-kling") : asset("hero-seedance");
  return own && own !== fallback ? `url(${own}), url(${fallback})` : `url(${fallback})`;
}
