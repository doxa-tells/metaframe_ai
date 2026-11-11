// Человеческие подписи для ошибок генерации (сырой текст провайдера остаётся в подсказке)
export type HumanError = { kind: string; title: string; text: string; hint?: string; raw?: string };

const IP_HINT = "Чаще всего срабатывает на известных персонажей и бренды, реальных людей и детей. Измените промпт или уберите такие референсы.";

export function humanizeError(status: string, raw?: string | null): HumanError {
  const e = (raw ?? "").trim();
  const has = (re: RegExp) => re.test(e);
  const base = { raw: e || undefined };
  if (status === "canceled") return { ...base, kind: "canceled", title: "Отменено", text: "Генерация остановлена" };
  if (status === "nsfw") return { ...base, kind: "censor", title: "Цензура", text: "Провайдер скрыл результат модерацией", hint: IP_HINT };

  if (has(/PrivacyInformation|may contain real person|реального человека/i))
    return { ...base, kind: "censor", title: "Реальное лицо", text: "Seedance не принимает референсы с реальными лицами — даже фотореалистичные сгенерированные", hint: "Попробуйте «Seedance 2.5 · Higgsfield», Kling или Gemini Omni" };
  if (has(/RECITATION|copyright|авторск/i))
    return { ...base, kind: "copyright", title: "Копирайт", text: "Результат слишком похож на защищённую работу или персонажа", hint: IP_HINT };
  if (has(/Input\w*Sensitive|Input\w*Risk|заблокировано \(|blockReason|prompt.*(blocked|rejected)|InputText|InputImage/i))
    return { ...base, kind: "censor", title: "Цензура", text: "Промпт или референсы не прошли модерацию", hint: IP_HINT };
  if (has(/Output\w*Sensitive|PROHIBITED_CONTENT|IMAGE_SAFETY|\bSAFETY\b|SPII|BLOCKLIST|nsfw|content.?policy|moderat|sensitive|модерац/i))
    return { ...base, kind: "censor", title: "Цензура", text: "Фильтр провайдера не пропустил результат", hint: IP_HINT };
  if (has(/модель ответила текстом|NO_IMAGE|IMAGE_OTHER|не вернул(а)? (изображение|видео)|пустой ответ|Модель не сделала видео|не вернула видео/i)) {
    const said = /«(.+)»/.exec(e)?.[1];
    return { ...base, kind: "empty", title: "Пусто", text: said ? `Модель ответила текстом: «${said.slice(0, 140)}»` : "Модель ответила, но ничего не нарисовала", hint: "Повторите или уточните промпт" };
  }
  if (has(/\b402\b|insufficient|balance|credit|AccountOverdue|Overdue|billing|payment|недостаточно средств/i))
    return { ...base, kind: "money", title: "Нет денег", text: "У провайдера закончился баланс", hint: "Пополните счёт и повторите" };
  if (has(/\b429\b|RESOURCE_EXHAUSTED|rate.?limit|TooManyRequests|quota|лимит/i))
    return { ...base, kind: "limit", title: "Лимит", text: "Слишком много запросов подряд", hint: "Подождите минуту и повторите" };
  if (has(/\b40[13]\b|API key|Unauthori[sz]ed|Authentication|PERMISSION_DENIED|ключ/i))
    return { ...base, kind: "auth", title: "Ключ", text: "Провайдер не принял API-ключ", hint: "Проверьте ключ в настройках Vercel" };
  if (has(/истекла|expired/i))
    return { ...base, kind: "expired", title: "Истекло", text: "Провайдер не успел и снял задачу", hint: "Повторите генерацию" };
  if (has(/не ответил|timed? ?out|ECONN|fetch failed|network|сет[ьи]|\b50[234]\b|UNAVAILABLE|overloaded|Хранилище/i))
    return { ...base, kind: "network", title: "Нет связи", text: "Провайдер или хранилище не ответили", hint: "Повторите через минуту" };
  if (has(/\b400\b|InvalidParameter|invalid|не поддерж|unsupported/i))
    return { ...base, kind: "params", title: "Параметры", text: e.replace(/^.*?:\s*/, "").slice(0, 160) || "Провайдер отклонил параметры" };
  return { ...base, kind: "other", title: "Ошибка", text: e.slice(0, 160) || "Генерация не удалась" };
}

// Одной строкой — для подсказок под полем ввода
export function humanizeMessage(raw: string): string {
  // Сообщения про аккаунт и лимиты студии уже человеческие
  if (/Аккаунт|Суточный лимит|Нужен вход|Soul ID вам недоступен|Только для владельца|Заявка на доступ|Недостаточно кредитов/.test(raw)) return raw;
  const h = humanizeError("failed", raw);
  return h.kind === "other" || h.kind === "params" ? raw : `${h.title}: ${h.text}${h.hint ? `. ${h.hint}` : ""}`;
}
