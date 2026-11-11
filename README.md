# AI Studio

Личный агрегатор генераций: Nano Banana 2.1 (Google), Seedream 5.0 и Seedance 2.5 (BytePlus напрямую), Higgsfield Soul 2 и Soul Cinema, Kling 4.0 (через Higgsfield).
Разделы: Фото (с историей), Видео, Ноды (React Flow) и боковой промпт-ассистент.

## Переменные окружения

| Переменная | Обязательна | Что это |
|---|---|---|
| `APP_PASSWORD` | да | пароль владельца: на странице входа оставить почту пустой и ввести его |
| `GEMINI_API_KEY` | для Nano Banana и чата | ключ Google AI Studio (с подключённой оплатой) |
| `ARK_API_KEY` | для Seedance и Seedream | ключ BytePlus ModelArk (console.byteplus.com/ark → API Key Management) |
| `HF_API_KEY` | для Soul 2, Soul Cinema, Kling | ключ Higgsfield API целиком (`id:secret`) из console.higgsfield.ai |
| `ANTHROPIC_API_KEY` | нет | если задан, чат работает на Claude |
| `STORAGE_URL` | да (на Vercel) | адрес воркера Cloudflare R2, например `https://metaframe-storage.<имя>.workers.dev` |
| `STORAGE_SECRET` | да (на Vercel) | общий секрет воркера (создаёт `cloudflare/setup.sh`) |
| `BLOB_READ_WRITE_TOKEN` | нет | запасной вариант: Vercel Blob вместо R2 |
| `NANO_BANANA_MODEL`, `GEMINI_CHAT_MODEL`, `ANTHROPIC_MODEL`, `ARK_MODEL_SEEDANCE_2_5`, `ARK_MODEL_SEEDREAM_5_0_PRO` и т.п. | нет | переопределить ID моделей |
| `ARK_BASE_URL` | нет | по умолчанию `https://ark.ap-southeast.bytepluses.com/api/v3` |
| `MOCK_PROVIDERS=1` | нет | тестовый режим без реальных генераций |
| `USER_DAILY_LIMIT` | нет | суточный лимит расходов пользователя в $ (по умолчанию 5; у каждого можно поменять в админке) |
| `USER_AUTO_FREEZE` | нет | сколько отказов модерации за сутки замораживают пользователя (по умолчанию 10) |

## Локальный запуск

```
npm install
printf 'APP_PASSWORD=test\nMOCK_PROVIDERS=1\n' > .env.local
npm run dev
```

## Как устроено

- `lib/models.ts` — реестр моделей: режимы, параметры, входы, цены. Новая модель Higgsfield добавляется сюда без изменений в интерфейсе.
- `lib/providers/*` — адаптеры Higgsfield API и Gemini API.
- `lib/jobs.ts` — задачи: отправка, опрос статуса, копирование результата в своё хранилище (Higgsfield хранит файлы 7 дней).
- `lib/storage.ts` — Cloudflare R2 через воркер (`cloudflare/`), Vercel Blob или локальная папка `.data`.
- `cloudflare/` — воркер хранилища: отдаёт файлы публично (с Range для видео), пишет по секрету, браузер грузит референсы по подписанной ссылке.
- `components/nodes/*` — нодовый редактор и исполнение графа.

## Хранилище (Cloudflare R2)

```
bash cloudflare/setup.sh
```

Скрипт входит в Cloudflare, создаёт бакет `metaframe`, выкладывает воркер `metaframe-storage`, задаёт секрет, прописывает `STORAGE_URL` и `STORAGE_SECRET` в Vercel и пушит код. Значения также сохраняются в `.storage-env` (в git не попадает).

## Выкладка на Vercel

1. Установите Node.js 20+ (nodejs.org).
2. В папке проекта: `npm install`, затем `npx vercel` — войдите в аккаунт и подтвердите создание проекта `ai-studio`.
3. Хранилище: `bash cloudflare/setup.sh` (см. выше).
4. В Settings → Environment Variables добавьте `APP_PASSWORD`, `GEMINI_API_KEY`, `ARK_API_KEY`, `HF_API_KEY`.
5. `npx vercel --prod` — выкладка в продакшен.

## Пользователи и модерация

- Регистрация на странице входа → аккаунт «на проверке». Владелец подтверждает личность в разделе **Админ** (вкладка видна только владельцу).
- Данные пользователей разделены: генерации в `u/<uid>/jobs/`, чаты, ноды и избранное — в `u/<uid>/`, у каждого своя группа ассетов BytePlus.
- Меры: предупреждение (пользователь подтверждает прочтение), снятие генерации, заморозка на срок, блокировка (все сессии сразу закрываются), суточный лимит.
- Отказы модерации провайдеров учитываются автоматически; журнал всех действий — во вкладке «Журнал модерации».
- Аккаунты и журнал хранятся в R2 зашифрованными (ключ выводится из `STORAGE_SECRET`; не меняйте его, иначе записи станут нечитаемыми).
