# Production environment variables (checklist)

В репозитории обычно есть только локальный `.env.local` (не коммитить). Для Vercel/прода задайте те же **имена** переменных; значения — из секретов провайдеров.

## Обязательные для базовой работы приложения

| Variable | Назначение |
|----------|------------|
| `NEXT_PUBLIC_SUPABASE_URL` | URL проекта Supabase |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Публичный anon key (клиент + middleware) |
| `SUPABASE_SERVICE_ROLE_KEY` | Только сервер: admin API, cron, ingest |

## OAuth и рекламные API

| Variable | Назначение |
|----------|------------|
| `META_APP_ID`, `META_APP_SECRET`, `META_REDIRECT_URI` | Meta OAuth |
| `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_REDIRECT_URI` | Google OAuth |
| `GOOGLE_ADS_DEVELOPER_TOKEN` | Google Ads API (без лишнего пробела после `=`) |
| `TIKTOK_APP_ID` или `TIKTOK_CLIENT_KEY`, `TIKTOK_CLIENT_SECRET`, `TIKTOK_REDIRECT_URI` | TikTok OAuth |

## Billing (Paddle)

| Variable | Назначение |
|----------|------------|
| `NEXT_PUBLIC_PADDLE_CLIENT_TOKEN`, `NEXT_PUBLIC_PADDLE_ENV` | Клиент Paddle.js |
| `NEXT_PUBLIC_PADDLE_PRICE_*`, `NEXT_PUBLIC_PADDLE_PRODUCT_*` | Тарифы/продукты |
| `PADDLE_API_KEY` | Серверные вызовы Paddle |
| `PADDLE_WEBHOOK_SECRET` | Верификация webhooks |

## Внутренние cron / sync / hardening

| Variable | Назначение |
|----------|------------|
| `INTERNAL_SYNC_SECRET` | Заголовок `x-internal-sync-secret` для internal routes |
| `CRON_SECRET` | Bearer для Vercel Cron (рекомендуется задать в проде) |
| `NEXT_PUBLIC_APP_URL` | Явный базовый URL сайта (cron, share-ссылки; иначе fallback на `VERCEL_URL`) |
| `UPSTASH_REDIS_REST_URL`, `UPSTASH_REDIS_REST_TOKEN` | Распределённый rate-limit |
| `CURRENCYAPI_KEY` | `/api/system/update-rates` |

## Опционально

| Variable | Назначение |
|----------|------------|
| `NEXT_PUBLIC_TRACKING_DOMAIN` или `TRACKING_DOMAIN` | Домен для UTM/redirect ссылок в UI |
| `TRACKING_RETENTION_*` | Окна retention для `/api/internal-sync/tracking-retention` |
| `INTERNAL_SYNC_CRON_MAX_PROJECTS` | Лимит проектов за один internal sync cron |
| `NEXT_PUBLIC_SYNC_STATUS_*` | Пороги Data Status (минуты) |
| `FEATURE_UNIFIED_TOKEN_HEALTH` | `1` — включить unified token health |
| `RESEND_API_KEY`, `RESEND_FROM_EMAIL` | Письма (data-deletion и др.) |
| `PRIVACY_CONTACT_EMAIL` | Контакт в data-deletion |
| `SMTP_*`, `REFUND_REQUEST_TO`, `PARTNERSHIP_LEAD_TO` | Альтернативная отправка писем |

## Что проверить перед релизом

1. В Vercel заданы все переменные из блоков «Обязательные», «OAuth», «Billing», «Внутренние cron» — по необходимости вашего релиза.
2. `CRON_SECRET` и `INTERNAL_SYNC_SECRET` в проде — **не** dev-значения; длинные случайные строки.
3. `NEXT_PUBLIC_APP_URL` = канонический URL продакшена (например `https://boardiq.kz`).
4. Нет опечаток в `.env`: значение не должно начинаться с пробела после `=` (иначе токен может не совпасть с API).

## Соответствие `vercel.json` crons

Cron-и вызывают защищённые routes — в проде должны быть заданы **`INTERNAL_SYNC_SECRET`** (обязательно: server-to-server `POST /api/dashboard/sync` из `/api/internal-sync/cron` и заголовок для части jobs) и **`CRON_SECRET`** (Vercel подставляет `Authorization: Bearer …`).

- `/api/system/update-rates` — Vercel дергает **GET**; поддерживаются те же способы auth, что и у `POST` (заголовок internal, Bearer `CRON_SECRET` / `INTERNAL_SYNC_SECRET`, сессия или system role).
- `/api/internal-sync/cron` и связанные internal routes — см. [`app/api/internal-sync/cron/route.ts`](../app/api/internal-sync/cron/route.ts).
