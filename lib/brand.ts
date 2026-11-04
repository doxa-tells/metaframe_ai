// Хромовые картинки интерфейса (public/assets)
export const asset = (name: string) => `/assets/${name}.webp`;

// Эмблема компании-разработчика модели
export function emblemFor(modelId: string): string {
  if (modelId.startsWith("nano-banana")) return asset("emblem-google");
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
  if (modeId === "reference") return asset("icon-mode-ref");
  return asset("icon-mode-text");
}

// Баннер карточки модели (для моделей без своего баннера — общий)
export function heroFor(modelId: string): string {
  return modelId.startsWith("kling") ? asset("hero-kling") : asset("hero-seedance");
}
