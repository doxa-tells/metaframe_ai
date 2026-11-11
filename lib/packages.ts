// Пакеты кредитов и реквизиты оплаты (пока перевод на Kaspi вручную, без эквайринга)
export type CreditPackage = { id: "hobby" | "plus" | "pro"; name: string; credits: number; price: number; hint: string; examples: string[] };

export const PACKAGES: CreditPackage[] = [
  { id: "hobby", name: "Hobby", credits: 200, price: 4990, hint: "Познакомиться и делать редкие генерации",
    examples: ["≈100 фото Nano Banana 2K", "≈5 видео Seedance 5 с 720p"] },
  { id: "plus", name: "Plus", credits: 1000, price: 20990, hint: "Регулярная работа над контентом",
    examples: ["≈500 фото Nano Banana 2K", "≈28 видео Seedance 5 с 720p"] },
  { id: "pro", name: "Pro", credits: 3000, price: 59990, hint: "Коммерческие проекты и много видео",
    examples: ["≈1 500 фото Nano Banana 2K", "≈85 видео Seedance 5 с 720p"] },
];

export const getPackage = (id: unknown) => PACKAGES.find((p) => p.id === id);

export const KASPI_PHONE_DISPLAY = "+7 (705) 992-64-40";
export const KASPI_PHONE_COPY = "7059926440";   // 10 цифр — так номер встаёт в поле Kaspi после «+7»
export const WHATSAPP_NUMBER = "77059926440";   // для ссылки wa.me

export const formatTenge = (n: number) => `${n.toLocaleString("ru-RU")} ₸`;
