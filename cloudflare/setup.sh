#!/usr/bin/env bash
# MetaFrame AI — хранилище на Cloudflare R2 + выкладка.
# Запуск: bash cloudflare/setup.sh   (можно запускать повторно)
set -euo pipefail

CF_DIR="$(cd "$(dirname "$0")" && pwd)"
APP_DIR="$(cd "$CF_DIR/.." && pwd)"
ENV_FILE="$APP_DIR/.storage-env"
VERCEL_PROJECT="${VERCEL_PROJECT:-metaframe-ai}"
WR="npx -y wrangler@4"

say()  { printf '\n\033[1;36m▸ %s\033[0m\n' "$*"; }
warn() { printf '\033[1;33m! %s\033[0m\n' "$*"; }

command -v node >/dev/null || { echo "Нужен Node.js 20+ (nodejs.org)"; exit 1; }
cd "$CF_DIR"

# 1. Вход в Cloudflare
say "Cloudflare: вход"
if ! $WR whoami 2>/dev/null | grep -q "associated with the email"; then
  $WR login
fi

# 2. Бакет R2
say "R2: бакет metaframe"
while true; do
  if OUT=$($WR r2 bucket create metaframe 2>&1); then echo "Создан."; break; fi
  if echo "$OUT" | grep -qi "already exists\|already own"; then echo "Уже есть."; break; fi
  echo "$OUT" | tail -5
  if echo "$OUT" | grep -qi "enable R2\|10042"; then
    warn "R2 ещё не включён в аккаунте. Откройте dash.cloudflare.com → R2 Object Storage → Enable / Purchase (бесплатный тариф, нужна карта)."
    open "https://dash.cloudflare.com/?to=/:account/r2/overview" 2>/dev/null || true
    read -r -p "Включили? Нажмите Enter, чтобы повторить… " _
  else
    exit 1
  fi
done

# 3. Воркер
say "Воркер metaframe-storage: выкладка"
LOG="$(mktemp)"
# script сохраняет терминал, чтобы wrangler мог задать вопросы (например, выбрать поддомен workers.dev)
script -q "$LOG" $WR deploy
URL="$(grep -Eo 'https://[A-Za-z0-9.-]+\.workers\.dev' "$LOG" | head -1 || true)"
rm -f "$LOG"
if [ -z "$URL" ]; then
  read -r -p "Вставьте адрес воркера (https://metaframe-storage.….workers.dev): " URL
fi
URL="${URL%/}"

# 4. Секрет (при повторном запуске берём прежний)
say "Секрет воркера"
SECRET=""
[ -f "$ENV_FILE" ] && SECRET="$(grep '^STORAGE_SECRET=' "$ENV_FILE" | cut -d= -f2- || true)"
[ -n "$SECRET" ] || SECRET="$(openssl rand -hex 32)"
printf '%s' "$SECRET" | $WR secret put STORAGE_SECRET >/dev/null
printf 'STORAGE_URL=%s\nSTORAGE_SECRET=%s\n' "$URL" "$SECRET" > "$ENV_FILE"
chmod 600 "$ENV_FILE"
echo "Сохранено в .storage-env"

# 5. Проверка
say "Проверка хранилища"
OK=""
for _ in $(seq 1 12); do
  CODE="$(curl -s -o /dev/null -w '%{http_code}' -H "Authorization: Bearer $SECRET" "$URL/list?limit=1" || true)"
  if [ "$CODE" = "200" ]; then OK=1; break; fi
  sleep 5
done
[ -n "$OK" ] && echo "Хранилище отвечает: $URL" || warn "Воркер пока не ответил (код $CODE) — обычно проходит через минуту."

# 6. Переменные в Vercel
say "Vercel: STORAGE_URL и STORAGE_SECRET"
cd "$APP_DIR"
VERCEL_OK=""
if npx -y vercel@latest link --yes --project "$VERCEL_PROJECT"; then
  VERCEL_OK=1
  for NAME in STORAGE_URL STORAGE_SECRET; do
    VAL="$URL"; [ "$NAME" = "STORAGE_SECRET" ] && VAL="$SECRET"
    npx -y vercel@latest env rm "$NAME" production --yes >/dev/null 2>&1 || true
    printf '%s' "$VAL" | npx -y vercel@latest env add "$NAME" production >/dev/null 2>&1 || VERCEL_OK=""
  done
  [ -n "$VERCEL_OK" ] && echo "Готово." || warn "Не все переменные записались в Vercel."
else
  warn "Не удалось подключиться к проекту Vercel «$VERCEL_PROJECT»."
fi

# 7. Код на GitHub → Vercel сам пересоберёт
say "GitHub: пуш"
[ -f components/History.tsx ] && git rm -q components/History.tsx || true
git add -A
if ! git diff --cached --quiet; then
  git commit -q -m "Cloudflare R2 storage, new image/video UI, brand

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_012f6TA5SyPu5cBn2CC9thzQ"
fi
git push

say "Всё готово"
if [ -z "$VERCEL_OK" ]; then
  echo "Добавьте в Vercel → Settings → Environment Variables (Production) две строки из файла .storage-env:"
  echo "  STORAGE_URL=$URL"
  echo "  STORAGE_SECRET=(значение в .storage-env)"
  echo "и нажмите Redeploy."
else
  echo "Vercel пересобирает сайт после пуша — через пару минут хранилище заработает."
fi
