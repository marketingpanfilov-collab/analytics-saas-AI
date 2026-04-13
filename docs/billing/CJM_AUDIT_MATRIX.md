# CJM Billing — матрица точек и рисков (аудит)

**Канон доступа и тарифов:** [BILLING_ACCESS_MODEL.md](./BILLING_ACCESS_MODEL.md).

Карта «точка в пути → screen/reason → allowed_actions → UX → риск». Поведение клиента опирается на `resolved_ui_state` из bootstrap и единый `isBillingBlocking` в [`app/lib/billingBootstrapClient.ts`](../../app/lib/billingBootstrapClient.ts); канон resolver — [`billingShellResolver.ts`](../../app/lib/billingShellResolver.ts).

| Точка / сценарий | Типичный screen | Типичный reason / примечание | Ключевые actions | Текущий UX | Риск отвала / смягчение |
| --- | --- | --- | --- | --- | --- |
| Нет подписки Paddle (Free, `no_subscription`) | DASHBOARD | `OK` | `wildcard` (+ навигация по политике продукта) | Обычный продукт: в т.ч. **`/app/projects`**, создание первого проекта, лимиты по матрице Free | Не путать с **`unpaid` / `expired`**: это не Free |
| Не оплачено / просрочка | READ_ONLY_SHELL | BILLING_UNPAID, BILLING_PAST_DUE | `billing_manage`, … | Sticky баннер → модалка inline | Дубли модалок → guard `open`; триггеры → общий `BillingPricingModalProvider` |
| Истёк доступ | READ_ONLY_SHELL | BILLING_EXPIRED | как выше | как выше | как выше |
| Grace закончился | DASHBOARD / иные | BILLING_GRACE → далее см. resolver | по матрице | Баннеры, виджеты LIMITED | Не смешивать с PAYWALL без явного reason |
| Over limit | OVER_LIMIT_FULLSCREEN | OVER_LIMIT_* | `billing_manage`, навигация «снизить нагрузку» | Inline upgrade | `pending_plan_change` → без второго checkout |
| Смена тарифа в процессе | DASHBOARD (+ soft overlay) / при нарушении лимитов OVER_LIMIT | PLAN_CHANGE_PENDING | без повторной оплаты | Информационный блок в shell | Двойная оплата: disabled CTA везде |
| Invite / нет орг | INVITE_*, NO_ORG_ACCESS | — | нет `billing_checkout` | Копирайт support / invite | Оплата N/A — не открывать pricing-modal по триггерам без `isBillingBlocking` |
| Refund | BILLING_REFUNDED | — | support-first | Shell refunded | Не расширять контракт; без «тихого» checkout |

## Связь с кодом

- **Блокировка «нужна оплата»:** [`isBillingBlocking`](../../app/lib/billingBootstrapClient.ts) — экран **`PAYWALL`** (если когда-либо отдан resolver’ом), **`OVER_LIMIT_FULLSCREEN`**, а для **`READ_ONLY_SHELL`** — только при reason **`BILLING_UNPAID` / `BILLING_EXPIRED` / `BILLING_PAST_DUE`**. Типичный Free (`no_subscription` → **`DASHBOARD` + `OK`**) **не** блокируется этим helper’ом как paywall.
- **После оплаты:** `reloadBootstrap` single-flight, polling 2.5s, max 22 попыток, таймаут ~55s, затем fallback-копирайт.
- **Return path:** `resolvePostPaymentRedirect` (intended → origin → `/app/projects` → `/app`), валидация `validateBillingReturnPath`, очистка `clearBillingRouteStorage`.
- **Аналитика:** [`app/lib/billingCjmAnalytics.ts`](../../app/lib/billingCjmAnalytics.ts), дедуп `paywall_shown` / `checkout_opened` по `request_id` + screen.
