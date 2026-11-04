// Реестр моделей: параметры, режимы, входы и оценка цены.
// Используется и на клиенте (рисует панель параметров), и на сервере (собирает тело запроса).

export type Kind = "image" | "video";
export type MediaKind = "image" | "video" | "audio";
export type ProviderId = "google" | "higgsfield" | "byteplus";

export type Option = { value: string; label: string };

export type ParamSpec =
  | { key: string; label: string; type: "select"; options: Option[]; default: string; advanced?: boolean }
  | { key: string; label: string; type: "slider"; min: number; max: number; step: number; default: number; unit?: string; advanced?: boolean }
  | { key: string; label: string; type: "toggle"; default: boolean; advanced?: boolean }
  | { key: string; label: string; type: "text"; default: string; placeholder?: string; advanced?: boolean }
  | { key: string; label: string; type: "seed"; advanced?: boolean }
  | { key: string; label: string; type: "soulid"; advanced?: boolean }
  | { key: string; label: string; type: "preset"; presets: string; advanced?: boolean }; // стиль из каталога Higgsfield (presets — путь каталога)

export type InputSpec = {
  key: string; // поле в теле запроса
  label: string;
  kind: MediaKind;
  max: number;
  single?: boolean; // строка вместо массива
  required?: boolean;
  hint?: string;
};

export type ModeSpec = {
  id: string;
  label: string;
  endpoint?: string; // путь Higgsfield
  promptRequired: boolean;
  requireAnyInput?: boolean;
  inputs: InputSpec[];
  params: ParamSpec[];
  hint?: string;
  source?: { min: number; max: number; strict?: boolean }; // ограничения длины видео-исходника, с (strict — длиннее нельзя)
  hidden?: boolean; // режим не показывается вкладкой (используется как запасной)
  textFallback?: string; // без референсов запрос уходит в этот режим (текст → видео)
  refToken?: (kind: MediaKind, n: number) => string; // как ссылаться на референс в промпте
};

// Длительность загруженного видео-исходника: клиент кладёт её в params, в API она не уходит
export const SRC_DURATION = "__src_duration";

export type ModelSpec = {
  id: string;
  name: string;
  vendor: string;
  kind: Kind;
  provider: ProviderId;
  description: string;
  badge?: string;
  modes: ModeSpec[];
  priceNote: string;
  price: (modeId: string, params: Record<string, unknown>) => number; // USD
};

const opts = (...v: string[]): Option[] => v.map((x) => ({ value: x, label: x }));

// ---------- Nano Banana 2.1 (Google Gemini API) ----------
const NB_PRICE: Record<string, number> = { "1K": 0.0336, "2K": 0.0504, "4K": 0.113 };

const nanoBanana: ModelSpec = {
  id: "nano-banana-2.1",
  name: "Nano Banana 2.1",
  vendor: "Google",
  kind: "image",
  provider: "google",
  description: "Генерация и редактирование по тексту и до 14 референсам",
  badge: "NEW",
  priceNote: "Gemini API: $0.0336 за 1K, $0.0504 за 2K, $0.113 за 4K",
  price: (_m, p) => (NB_PRICE[String(p.image_size)] ?? 0.0504) * Number(p.count ?? 1),
  modes: [
    {
      id: "generate",
      label: "Генерация",
      promptRequired: true,
      inputs: [{ key: "refs", label: "Референсы", kind: "image", max: 14, hint: "до 10 объектов и 4 персонажей" }],
      params: [
        { key: "aspect_ratio", label: "Формат", type: "select", default: "auto",
          options: [{ value: "auto", label: "Авто" }, ...opts("1:1", "3:4", "4:3", "2:3", "3:2", "4:5", "5:4", "9:16", "16:9", "21:9", "1:4", "4:1", "1:8", "8:1")] },
        { key: "image_size", label: "Качество", type: "select", default: "2K", options: opts("1K", "2K", "4K") },
        { key: "count", label: "Количество", type: "select", default: "1", options: opts("1", "2", "3", "4") },
        { key: "thinking", label: "Размышление", type: "select", default: "medium", advanced: true,
          options: [{ value: "minimal", label: "Минимальное" }, { value: "medium", label: "Среднее" }, { value: "high", label: "Высокое" }] },
      ],
    },
  ],
};

// ---------- Higgsfield Soul 2 и Soul Cinema ----------
const SOUL_AR = opts("9:16", "3:4", "2:3", "1:1", "4:3", "3:2", "16:9");
const soulParams = (defAr: string, enhance: boolean, withStyle: boolean): ParamSpec[] => [
  { key: "aspect_ratio", label: "Формат", type: "select", default: defAr, options: SOUL_AR },
  { key: "resolution", label: "Качество", type: "select", default: "1080p", options: opts("720p", "1080p") },
  { key: "batch_size", label: "Количество", type: "select", default: "1", options: opts("1", "4") },
  { key: "custom_reference_id", label: "Soul ID (персонаж)", type: "soulid" },
  { key: "custom_reference_strength", label: "Сила Soul ID", type: "slider", min: 0, max: 1, step: 0.05, default: 1 },
  { key: "enhance_prompt", label: "Улучшать промпт", type: "toggle", default: enhance },
  ...(withStyle ? [{ key: "style_id", label: "Soul Style ID", type: "text", default: "", placeholder: "необязательно", advanced: true } as ParamSpec] : []),
  { key: "seed", label: "Seed", type: "seed", advanced: true },
];

const soul: ModelSpec = {
  id: "soul-2",
  name: "Higgsfield Soul 2",
  vendor: "Higgsfield",
  kind: "image",
  provider: "higgsfield",
  description: "Фотореализм в стиле fashion и Soul ID для своего персонажа",
  priceNote: "Higgsfield API: от $0.0032 за изображение",
  price: (_m, p) => 0.0032 * Number(p.batch_size ?? 1),
  modes: [{ id: "generate", label: "Генерация", endpoint: "higgsfield-ai/soul/v2/standard", promptRequired: true, inputs: [], params: soulParams("3:4", true, true) }],
};

const soulCinema: ModelSpec = {
  id: "soul-cinema",
  name: "Higgsfield Soul Cinema",
  vendor: "Higgsfield",
  kind: "image",
  provider: "higgsfield",
  description: "Кинокадры: плёночное зерно, свет, глубина. Хорош как первый кадр для видео",
  priceNote: "Higgsfield API: от $0.0032 за изображение",
  price: (_m, p) => 0.0032 * Number(p.batch_size ?? 1),
  modes: [{ id: "generate", label: "Генерация", endpoint: "higgsfield-ai/soul/cinema", promptRequired: true, inputs: [], params: soulParams("16:9", false, false),
    hint: "Стиль у модели фиксированный — кинематографичный" }],
};

// ---------- Seedream 5.0 (BytePlus ModelArk напрямую) ----------
const SR_AR = [{ value: "auto", label: "Авто" }, ...opts("1:1", "3:4", "4:3", "2:3", "3:2", "9:16", "16:9", "21:9")];
function seedream(id: string, name: string, description: string, sizes: string[], defSize: string, perImage: number, note: string, badge?: string): ModelSpec {
  return {
    id, name, vendor: "ByteDance", kind: "image", provider: "byteplus", description, badge,
    priceNote: note,
    price: (_m, p) => perImage * Number(p.count ?? 1),
    modes: [{
      id: "generate", label: "Генерация", promptRequired: true,
      inputs: [{ key: "refs", label: "Референсы", kind: "image", max: 10, hint: "для редактирования и смешивания" }],
      params: [
        { key: "aspect_ratio", label: "Формат", type: "select", default: "auto", options: SR_AR },
        { key: "size", label: "Качество", type: "select", default: defSize, options: opts(...sizes) },
        { key: "count", label: "Количество", type: "select", default: "1", options: opts("1", "2", "3", "4") },
      ],
    }],
  };
}
const seedreamLite = seedream("seedream-5.0-lite", "Seedream 5.0 Lite", "Быстро и дёшево, до 4K, хороший текст на картинках",
  ["2K", "3K", "4K"], "2K", 0.035, "BytePlus: $0.035 за изображение");
const seedreamPro = seedream("seedream-5.0-pro", "Seedream 5.0 Pro", "Максимум точности: портреты, сложные правки",
  ["1K", "1.5K", "2K"], "2K", 0.045, "BytePlus: $0.045 за изображение (+$0.003 за каждый референс после первого). Генерация до ~2 минут", "PRO");
const seedreamFlash = seedream("seedream-5.0-flash", "Seedream 5.0 Flash", "Самый быстрый Seedream",
  ["1K", "1.5K", "2K"], "2K", 0.02, "BytePlus: около $0.02 за изображение — точную цену смотрите в консоли");

// ---------- Seedance 2.5 (BytePlus ModelArk напрямую) ----------
const SD_RES = { key: "resolution", label: "Разрешение", type: "select", default: "720p", options: opts("480p", "720p", "1080p") } as const;
const SD_DUR = { key: "duration", label: "Длительность", type: "slider", min: 4, max: 30, step: 1, default: 5, unit: "с" } as const;
const SD_AR: ParamSpec = { key: "aspect_ratio", label: "Формат", type: "select", default: "16:9",
  options: [...opts("16:9", "9:16", "1:1", "4:3", "3:4", "21:9"), { value: "adaptive", label: "Авто" }] };
const SD_AUDIO = { key: "generate_audio", label: "Звук", type: "toggle", default: true } as const;
// Официальный прайс BytePlus, $/сек (без видео на входе)
const SD_PRICE: Record<string, number> = { "480p": 0.103, "720p": 0.231, "1080p": 0.569 };

const seedance: ModelSpec = {
  id: "seedance-2.5",
  name: "Seedance 2.5",
  vendor: "ByteDance",
  kind: "video",
  provider: "byteplus",
  description: "До 30 секунд, звук, до 50 референсов",
  badge: "TOP",
  priceNote: "BytePlus: $0.103/с 480p, $0.231/с 720p, $0.569/с 1080p",
  price: (_m, p) => (SD_PRICE[String(p.resolution)] ?? 0.231) * Number(p.duration ?? 5),
  modes: [
    {
      id: "reference", label: "Промпт и референсы", promptRequired: false, textFallback: "text",
      inputs: [
        { key: "image_urls", label: "Изображения", kind: "image", max: 30 },
        { key: "video_urls", label: "Видео (2–30 с)", kind: "video", max: 10 },
        { key: "audio_urls", label: "Аудио (wav/mp3)", kind: "audio", max: 10 },
      ],
      params: [SD_DUR, SD_RES, SD_AR, SD_AUDIO],
      refToken: (k, n) => `@${k === "image" ? "Image" : k === "video" ? "Video" : "Audio"} ${n}`,
      hint: "Референсы необязательны — без них видео строится по промпту. Ссылки: @Image 1, @Video 1, @Audio 1",
    },
    {
      id: "image", label: "Кадр → видео", promptRequired: false,
      inputs: [
        { key: "image_url", label: "Первый кадр", kind: "image", max: 1, single: true, required: true },
        { key: "end_image_url", label: "Последний кадр", kind: "image", max: 1, single: true },
      ],
      params: [SD_DUR, SD_RES, SD_AUDIO],
      hint: "Формат берётся из первого кадра",
    },
    { id: "text", label: "Текст → видео", hidden: true, promptRequired: true, inputs: [], params: [SD_DUR, SD_RES, SD_AR, SD_AUDIO] },
  ],
};

// ---------- Kling 4.0 (через Higgsfield API) ----------
const KL_DUR = { key: "duration", label: "Длительность", type: "slider", min: 3, max: 30, step: 1, default: 10, unit: "с" } as const;
const KL_RES = { key: "resolution", label: "Разрешение", type: "select", default: "1080p", options: opts("720p", "1080p") } as const;
const KL_PRICE: Record<string, number> = { "720p": 0.157, "1080p": 0.235 };

const kling: ModelSpec = {
  id: "kling-4.0",
  name: "Kling 4.0",
  vendor: "Kuaishou",
  kind: "video",
  provider: "higgsfield",
  description: "До 30 секунд, 10 ключевых кадров, стерео",
  badge: "NEW",
  priceNote: "Прайс Higgsfield API: $0.157/с 720p, $0.235/с 1080p (со скидкой дешевле)",
  price: (_m, p) => (KL_PRICE[String(p.resolution)] ?? 0.235) * Number(p.duration ?? 10),
  modes: [
    {
      id: "reference", label: "Промпт и референсы", endpoint: "kling-video/v4.0/reference-to-video",
      promptRequired: true, textFallback: "text",
      inputs: [
        { key: "image_urls", label: "Изображения", kind: "image", max: 10 },
        { key: "video_urls", label: "Видео", kind: "video", max: 5 },
      ],
      params: [KL_DUR, KL_RES, { key: "aspect_ratio", label: "Формат", type: "select", default: "adaptive",
        options: [{ value: "adaptive", label: "Авто" }, ...opts("16:9", "9:16", "1:1", "21:9")] }],
      refToken: (k, n) => `@${k}_${n}`,
      hint: "Референсы необязательны — без них видео строится по промпту. Ссылки: @image_1, @video_1",
    },
    {
      id: "image", label: "Ключевые кадры", endpoint: "kling-video/v4.0/image-to-video",
      promptRequired: false,
      inputs: [
        { key: "image_url", label: "Первый кадр", kind: "image", max: 1, single: true, required: true },
        { key: "image_urls", label: "Промежуточные кадры", kind: "image", max: 8, hint: "по порядку" },
        { key: "end_image_url", label: "Последний кадр", kind: "image", max: 1, single: true },
      ],
      params: [KL_DUR, KL_RES],
      hint: "Формат берётся из кадров. Опишите в промпте действие и движение камеры между кадрами",
    },
    {
      id: "text", label: "Текст → видео", endpoint: "kling-video/v4.0/text-to-video", hidden: true,
      promptRequired: true, inputs: [],
      params: [KL_DUR, KL_RES, { key: "aspect_ratio", label: "Формат", type: "select", default: "16:9", options: opts("16:9", "9:16", "1:1", "21:9") }],
    },
  ],
};

// ---------- Higgsfield Genjutsu (видео → видео) ----------
const GJ_RES: ParamSpec = { key: "resolution", label: "Разрешение", type: "select", default: "720p", options: opts("480p", "720p", "1080p") };
// Цена за секунду исходника (после обрезки), округляется вверх до целых секунд
const GJ_PRICE: Record<string, number> = { "480p": 0.159, "720p": 0.3405, "1080p": 0.816 };
const GJ_RESTYLE_PRICE: Record<string, number> = { "480p": 0.318, "720p": 0.681, "1080p": 1.632 };
const GJ_LIGHT_PRICE: Record<string, number> = { "480p": 0.05, "720p": 0.1, "1080p": 0.2 };
const srcSeconds = (p: Record<string, unknown>, max: number) => {
  const d = Number(p[SRC_DURATION]);
  return Math.ceil(Math.min(max, Number.isFinite(d) && d > 0 ? d : 10));
};
const GJ_SOURCE = { key: "video_url", label: "Исходное видео", kind: "video", max: 1, single: true, required: true } as const;

const genjutsu: ModelSpec = {
  id: "genjutsu",
  name: "Genjutsu",
  vendor: "Higgsfield",
  kind: "video",
  provider: "higgsfield",
  description: "Видео → видео: перенос движения, замена объекта, рестайл",
  priceNote: "Higgsfield API: $0.159/с 480p, $0.34/с 720p, $0.816/с 1080p (рестайл ×2) — за секунды исходника, до 30 с",
  price: (m, p) => (m === "restyle" ? GJ_RESTYLE_PRICE : GJ_PRICE)[String(p.resolution)] * srcSeconds(p, 30) || 0,
  modes: [
    {
      id: "motion", label: "Перенос движения", endpoint: "higgsfield/genjutsu/motion-transfer/v1.0",
      promptRequired: false, source: { min: 4, max: 30 },
      inputs: [GJ_SOURCE, { key: "image_urls", label: "Персонажи и сцена", kind: "image", max: 8, required: true, hint: "до 8 картинок: кто играет и где" }],
      params: [GJ_RES], refToken: (_k, n) => `@image_${n}`,
      hint: "Движение, камера и тайминг берутся из видео (4–30 с), а всё в кадре — с картинок",
    },
    {
      id: "swap", label: "Замена объекта", endpoint: "higgsfield/genjutsu/object-swap/v1.0",
      promptRequired: false, source: { min: 4, max: 30 },
      inputs: [GJ_SOURCE, { key: "image_urls", label: "На что заменить", kind: "image", max: 8, required: true, hint: "до 8 картинок нового объекта" }],
      params: [GJ_RES], refToken: (_k, n) => `@image_${n}`,
      hint: "Видео 4–30 с, не меньше ~640×640. В промпте укажите, что заменить: «замени кружку на @image_1»",
    },
    {
      id: "restyle", label: "Рестайл", endpoint: "higgsfield/genjutsu/restyle/v1.0",
      promptRequired: false, source: { min: 4, max: 30 },
      inputs: [GJ_SOURCE, { key: "image_urls", label: "Персонажи", kind: "image", max: 5, hint: "необязательно, до 5" }],
      params: [{ key: "preset_id", label: "Стиль", type: "preset", presets: "models/higgsfield/genjutsu/restyle/v1.0/presets" }, GJ_RES],
      refToken: (_k, n) => `@image_${n}`,
      hint: "Перерисовывает всё видео в выбранном стиле (4–30 с). Картинки — только для персонажей",
    },
  ],
};

const genjutsuLight: ModelSpec = {
  id: "genjutsu-light",
  name: "Genjutsu Light",
  vendor: "Higgsfield",
  kind: "video",
  provider: "higgsfield",
  description: "В разы дешевле Genjutsu: перенос движения и замена объекта, до 15 с",
  badge: "NEW",
  priceNote: "Higgsfield API: ~$0.05/с 480p, $0.10/с 720p, $0.20/с 1080p — за секунды результата, до 15 с",
  price: (_m, p) => GJ_LIGHT_PRICE[String(p.resolution)] * srcSeconds(p, 15) || 0,
  modes: [
    {
      id: "motion", label: "Перенос движения", endpoint: "higgsfield/genjutsu-light/motion-transfer/v1.0",
      promptRequired: false, source: { min: 1, max: 15 },
      inputs: [GJ_SOURCE, { key: "image_urls", label: "Персонажи и сцена", kind: "image", max: 8, required: true, hint: "до 8 картинок: кто играет и где" }],
      params: [GJ_RES], refToken: (_k, n) => `@image_${n}`,
      hint: "Берутся первые 15 с видео, звук сохраняется",
    },
    {
      id: "swap", label: "Замена объекта", endpoint: "higgsfield/genjutsu-light/object-swap/v1.0",
      promptRequired: false, source: { min: 1, max: 15 },
      inputs: [GJ_SOURCE, { key: "image_urls", label: "На что заменить", kind: "image", max: 8, required: true, hint: "до 8 картинок нового объекта" }],
      params: [GJ_RES], refToken: (_k, n) => `@image_${n}`,
      hint: "Берутся первые 15 с видео. В промпте укажите, что заменить: «замени кружку на @image_1»",
    },
  ],
};

// ---------- Gemini Omni 1.1 Flash (Google, преемник Veo в Gemini API) ----------
const OM_RES: ParamSpec = { key: "resolution", label: "Разрешение", type: "select", default: "720p",
  options: [{ value: "360p", label: "360p (черновик)" }, { value: "720p", label: "720p" }, { value: "1080p", label: "1080p" }, { value: "4k", label: "4K" }] };
const OM_DUR: ParamSpec = { key: "duration", label: "Длительность", type: "slider", min: 3, max: 10, step: 1, default: 8, unit: "с" };
const OM_AR: ParamSpec = { key: "aspect_ratio", label: "Формат", type: "select", default: "16:9", options: opts("16:9", "9:16") };
// Прайс Gemini API за секунду результата
const OM_PRICE: Record<string, number> = { "360p": 0.03, "720p": 0.1, "1080p": 0.15, "4k": 0.3 };

const omni: ModelSpec = {
  id: "gemini-omni-flash",
  name: "Gemini Omni Flash",
  vendor: "Google",
  kind: "video",
  provider: "google",
  description: "Новое поколение Veo: видео со звуком 3–10 с, кадры, референсы и правка видео словами",
  badge: "NEW",
  priceNote: "Gemini API: $0.03/с 360p, $0.10/с 720p, $0.15/с 1080p, $0.30/с 4K. Длительность модель выбирает сама (3–10 с), ориентир — в настройках",
  price: (m, p) => (OM_PRICE[String(p.resolution)] ?? 0.1) * (m === "edit" ? srcSeconds(p, 10) : Number(p.duration ?? 8)),
  modes: [
    {
      id: "reference", label: "Промпт и референсы", promptRequired: true, textFallback: "text",
      inputs: [
        { key: "image_urls", label: "Изображения", kind: "image", max: 3 },
        { key: "video_urls", label: "Видео (до 3 с)", kind: "video", max: 3 },
      ],
      params: [OM_DUR, OM_RES, OM_AR],
      refToken: (k, n) => `<${k === "video" ? "VIDEO" : "IMAGE"}_REF_${n - 1}>`,
      hint: "Референсы необязательны. Ссылки: <IMAGE_REF_0>, <VIDEO_REF_0> (нумерация с нуля). Звук модель делает сама — опишите его в промпте",
    },
    {
      id: "image", label: "Кадры → видео", promptRequired: false,
      inputs: [
        { key: "image_url", label: "Первый кадр", kind: "image", max: 1, single: true, required: true },
        { key: "end_image_url", label: "Последний кадр", kind: "image", max: 1, single: true },
      ],
      params: [OM_DUR, OM_RES],
      hint: "Формат берётся из кадра. С двумя кадрами — плавный переход от первого к последнему",
    },
    {
      id: "edit", label: "Правка видео", promptRequired: true, source: { min: 1, max: 10, strict: true },
      inputs: [{ key: "video_url", label: "Видео (до 10 с)", kind: "video", max: 1, single: true, required: true }],
      params: [OM_RES],
      hint: "Опишите, что изменить: «сделай свет драматичнее, остальное оставь как есть». Видео до 10 с",
    },
    { id: "text", label: "Текст → видео", hidden: true, promptRequired: true, inputs: [], params: [OM_DUR, OM_RES, OM_AR] },
  ],
};

// План запроса к Interactions API: какие медиа отправить (по порядку), текст и настройки ответа
export function buildOmniPlan(req: GenRequest): {
  media: { url: string; kind: "image" | "video" }[]; text: string; responseFormat: Record<string, string>; task?: string;
} {
  const p = req.params ?? {};
  const inp = req.inputs ?? {};
  const list = (k: string) => (inp[k] ?? []).filter(Boolean);
  const media: { url: string; kind: "image" | "video" }[] = [];
  let task: string | undefined;
  const responseFormat: Record<string, string> = { type: "video", resolution: String(p.resolution ?? "720p") };
  if (req.modeId === "image") {
    for (const u of [...list("image_url").slice(0, 1), ...list("end_image_url").slice(0, 1)]) media.push({ url: u, kind: "image" });
    task = "image_to_video";
  } else if (req.modeId === "edit") {
    for (const u of list("video_url").slice(0, 1)) media.push({ url: u, kind: "video" });
    task = "edit";
  } else {
    for (const u of list("image_urls")) media.push({ url: u, kind: "image" });
    for (const u of list("video_urls")) media.push({ url: u, kind: "video" });
    if (media.length) task = "reference_to_video";
    responseFormat.aspect_ratio = String(p.aspect_ratio ?? "16:9");
  }
  let text = (req.prompt ?? "").trim();
  // У API нет параметра длительности — подсказываем её в промпте
  if (req.modeId !== "edit" && p.duration) text = `${text}${text ? "\n\n" : ""}Video length: about ${Number(p.duration)} seconds.`;
  return { media, text, responseFormat, task };
}

export const MODELS: ModelSpec[] = [nanoBanana, seedreamLite, seedreamPro, seedreamFlash, soul, soulCinema, seedance, kling, omni, genjutsu, genjutsuLight];

export function getModel(id: string): ModelSpec | undefined {
  return MODELS.find((m) => m.id === id);
}
export function getMode(model: ModelSpec, modeId: string): ModeSpec {
  return model.modes.find((m) => m.id === modeId) ?? model.modes[0];
}
// Видимый режим: скрытый (запасной) режим показывается как тот, что в него переходит
export function visibleMode(model: ModelSpec, modeId: string): ModeSpec {
  const m = getMode(model, modeId);
  if (!m.hidden) return m;
  return model.modes.find((x) => x.textFallback === m.id) ?? model.modes.find((x) => !x.hidden) ?? m;
}
export const firstMode = (model: ModelSpec) => model.modes.find((x) => !x.hidden) ?? model.modes[0];

// Без референсов режим «Промпт и референсы» отправляется как «Текст → видео»
export function resolveRequest(req: GenRequest): GenRequest {
  const model = getModel(req.modelId);
  if (!model) return req;
  const mode = getMode(model, req.modeId);
  if (!mode.textFallback) return req;
  const any = mode.inputs.some((i) => (req.inputs?.[i.key] ?? []).some(Boolean));
  if (any) return req;
  const fb = getMode(model, mode.textFallback);
  const params: Record<string, unknown> = {};
  for (const p of fb.params) {
    let v = req.params?.[p.key];
    if (p.type === "select" && (v === undefined || !p.options.some((o) => o.value === String(v)))) v = p.default;
    if (v !== undefined) params[p.key] = v;
  }
  return { ...req, modeId: fb.id, params, inputs: {} };
}

export function defaultParams(mode: ModeSpec): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const p of mode.params) {
    if ("default" in p) out[p.key] = p.default;
    else out[p.key] = null;
  }
  return out;
}

export type GenInputs = Record<string, string[]>; // ключ входа -> список URL

export type GenRequest = {
  modelId: string;
  modeId: string;
  prompt: string;
  params: Record<string, unknown>;
  inputs: GenInputs;
};

// Проверка и нормализация запроса. Возвращает текст ошибки или null.
export function validateRequest(req: GenRequest): string | null {
  const model = getModel(req.modelId);
  if (!model) return "Неизвестная модель";
  const mode = model.modes.find((m) => m.id === req.modeId);
  if (!mode) return "Неизвестный режим";
  const prompt = (req.prompt ?? "").trim();
  if (mode.promptRequired && !prompt) return "Введите промпт";
  let anyInput = false;
  for (const inp of mode.inputs) {
    const list = (req.inputs?.[inp.key] ?? []).filter(Boolean);
    if (inp.required && list.length === 0) return `Добавьте: ${inp.label}`;
    if (list.length > inp.max) return `${inp.label}: максимум ${inp.max}`;
    if (list.length) anyInput = true;
  }
  if (mode.requireAnyInput && !anyInput) return "Добавьте хотя бы один референс";
  if (mode.textFallback && !anyInput && !prompt) return "Введите промпт или добавьте референсы";
  if (mode.source) {
    const d = Number(req.params?.[SRC_DURATION]);
    if (Number.isFinite(d) && d > 0 && d < mode.source.min - 0.05) return `Исходное видео должно быть не короче ${mode.source.min} с`;
    if (mode.source.strict && Number.isFinite(d) && d > mode.source.max + 0.05) return `Исходное видео должно быть не длиннее ${mode.source.max} с`;
  }
  for (const p of mode.params) {
    const v = req.params?.[p.key];
    if (p.type === "preset" && !v) return `Выберите: ${p.label}`;
    if (v === undefined || v === null || v === "") continue;
    if (p.type === "select" && !p.options.some((o) => o.value === String(v))) return `${p.label}: недопустимое значение`;
    if (p.type === "slider") {
      const n = Number(v);
      if (!Number.isFinite(n) || n < p.min || n > p.max) return `${p.label}: от ${p.min} до ${p.max}`;
    }
  }
  return null;
}

// Тело запроса к Higgsfield API для выбранного режима
export function buildHiggsfieldBody(req: GenRequest): { endpoint: string; body: Record<string, unknown> } {
  const model = getModel(req.modelId)!;
  const mode = getMode(model, req.modeId);
  const body: Record<string, unknown> = {};
  const prompt = (req.prompt ?? "").trim();
  if (prompt) body.prompt = prompt;
  for (const p of mode.params) {
    const v = req.params?.[p.key];
    if (v === undefined || v === null || v === "") continue;
    switch (p.type) {
      case "slider": body[p.key] = Number(v); break;
      case "toggle": body[p.key] = Boolean(v); break;
      case "seed": { const n = Number(v); if (Number.isInteger(n) && n >= 1) body[p.key] = n; break; }
      case "select": {
        // Числовые селекты отправляем числом
        body[p.key] = p.key === "batch_size" ? Number(v) : String(v);
        break;
      }
      default: body[p.key] = String(v);
    }
  }
  // Сила Soul ID имеет смысл только вместе с персонажем
  if (!body.custom_reference_id) delete body.custom_reference_strength;
  for (const inp of mode.inputs) {
    const list = (req.inputs?.[inp.key] ?? []).filter(Boolean);
    if (!list.length) continue;
    body[inp.key] = inp.single ? list[0] : list;
  }
  return { endpoint: mode.endpoint!, body };
}

// ---------- BytePlus ModelArk ----------
export const ARK_MODEL_IDS: Record<string, string> = {
  "seedance-2.5": "dreamina-seedance-2-5-260628",
  "seedream-5.0-lite": "seedream-5-0-260128",
  "seedream-5.0-pro": "dola-seedream-5-0-pro-260628",
  "seedream-5.0-flash": "dola-seedream-5-0-flash-260915",
};

// Точный размер под формат: площадь как у выбранного уровня качества, стороны кратны 16
const TIER_SIDE: Record<string, number> = { "1K": 1024, "1.5K": 1536, "2K": 2048, "3K": 3072, "4K": 4096 };
export function seedreamSize(tier: string, aspect: string): string {
  if (!aspect || aspect === "auto") return tier;
  const [w, h] = aspect.split(":").map(Number);
  const side = TIER_SIDE[tier] ?? 2048;
  const r = Math.sqrt(w / h);
  return `${Math.floor((side * r) / 16) * 16}x${Math.floor(side / r / 16) * 16}`;
}

// Тело запроса Seedance 2.5 для /contents/generations/tasks (входы — абсолютные URL или data URI)
export function buildArkVideoBody(req: GenRequest, model: string): Record<string, unknown> {
  const p = req.params ?? {};
  const content: Record<string, unknown>[] = [];
  const prompt = (req.prompt ?? "").trim();
  if (prompt) content.push({ type: "text", text: prompt });
  const inp = req.inputs ?? {};
  const first = (inp.image_url ?? []).filter(Boolean)[0];
  const last = (inp.end_image_url ?? []).filter(Boolean)[0];
  if (req.modeId === "image") {
    if (first) content.push({ type: "image_url", image_url: { url: first }, role: "first_frame" });
    if (last) content.push({ type: "image_url", image_url: { url: last }, role: "last_frame" });
  } else if (req.modeId === "reference") {
    for (const u of (inp.image_urls ?? []).filter(Boolean)) content.push({ type: "image_url", image_url: { url: u }, role: "reference_image" });
    for (const u of (inp.video_urls ?? []).filter(Boolean)) content.push({ type: "video_url", video_url: { url: u }, role: "reference_video" });
    for (const u of (inp.audio_urls ?? []).filter(Boolean)) content.push({ type: "audio_url", audio_url: { url: u }, role: "reference_audio" });
  }
  const body: Record<string, unknown> = {
    model,
    content,
    resolution: String(p.resolution ?? "720p"),
    duration: Number(p.duration ?? 5),
    generate_audio: p.generate_audio === undefined ? true : Boolean(p.generate_audio),
    watermark: false,
  };
  body.ratio = req.modeId === "image" ? "adaptive" : String(p.aspect_ratio ?? "16:9");
  return body;
}

export function buildArkImageBody(req: GenRequest, model: string, refs: string[]): Record<string, unknown> {
  const p = req.params ?? {};
  const body: Record<string, unknown> = {
    model,
    prompt: (req.prompt ?? "").trim(),
    size: seedreamSize(String(p.size ?? "2K"), String(p.aspect_ratio ?? "auto")),
    response_format: "url",
    watermark: false,
  };
  if (refs.length) body.image = refs.length === 1 ? refs[0] : refs;
  return body;
}

export function estimateCost(req: GenRequest): number {
  const model = getModel(req.modelId);
  if (!model) return 0;
  return Math.round(model.price(req.modeId, req.params ?? {}) * 10000) / 10000;
}

export function formatUsd(n: number): string {
  if (!n) return "$0";
  if (n < 0.1) return `$${n.toFixed(4).replace(/0+$/, "")}`;
  return `$${n.toFixed(2)}`;
}
