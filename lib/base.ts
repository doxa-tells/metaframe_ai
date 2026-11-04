// Приложение живёт по адресу metaframe.ltd/studio — все корневые пути идут через этот префикс
export const BASE = "/studio";
export const withBase = (p: string): string =>
  p.startsWith("/") && !p.startsWith("//") && p !== BASE && !p.startsWith(BASE + "/") ? BASE + p : p;
