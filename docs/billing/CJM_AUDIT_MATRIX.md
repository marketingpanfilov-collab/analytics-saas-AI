# CJM Billing — матрица точек и рисков (аудит)

Карта «точка в пути → screen/reason → allowed_actions → UX → риск». Resolver/API не менялись; поведение клиента опирается на `resolved_ui_state` и единый `isBillingBlocking` в [`app/lib/billingBootstrapClient.ts`](../../app/lib/billingBootstrapClient.ts).

| Точка / сценарий | Типичный screen | Типичный reason / примечание | Ключевые actions | Текущий UX | Риск отвала / смягчение |
| --- | --- | --- | --- | --- | --- |
| Нет подписки | PAYWALL | BILLING_NO_SUBSCRIPTION | `billing_checkout`, … | Hard shell + inline Paddle | Задержка webhook → polling + «Обновить статус» |
| Не оплачено / просрочка | READ_ONLY_SHELL | BILLING_UNPAID, BILLING_PAST_DUE | `billing_manage`, … | Sticky баннер → модалка inline | Дубли модалок → guard `open`; триггеры → общий `BillingPricingModalProvider` |
| Истёк доступ | READ_ONLY_SHELL | BILLING_EXPIRED | как выше | как выше | как выше |
| Grace закончился | DASHBOARD / иные | BILLING_GRACE → далее см. resolver | по матрице | Баннеры, виджеты LIMITED | Не смешивать с PAYWALL без явного reason |
| Over limit | OVER_LIMIT_FULLSCREEN | OVER_LIMIT_* | `billing_manage`, навигация «снизить нагрузку» | Inline upgrade | `pending_plan_change` → без второго checkout |
| Смена тарифа в процессе | PAYWALL / OVER_LIMIT | PLAN_CHANGE_PENDING | без повторной оплаты | Информационный блок в shell | Двойная оплата: disabled CTA везде |
| Invite / нет орг | INVITE_*, NO_ORG_ACCESS | — | нет `billing_checkout` | Копирайт support / invite | Оплата N/A — не открывать pricing-modal по триггерам без `isBillingBlocking` |
| Refund | BILLING_REFUNDED | — | support-first | Shell refunded | Не расширять контракт; без «тихого» checkout |

## Связь с кодом

- **Блокировка «нужна оплата»:** `isBillingBlocking(resolvedUi)` — PAYWALL, OVER_LIMIT_FULLSCREEN, READ_ONLY только для UNPAID / EXPIRED / PAST_DUE.
- **После оплаты:** `reloadBootstrap` single-flight, polling 2.5s, max 22 попыток, таймаут ~55s, затем fallback-копирайт.
- **Return path:** `resolvePostPaymentRedirect` (intended → origin → `/app/projects` → `/app`), валидация `validateBillingReturnPath`, очистка `clearBillingRouteStorage`.
- **Аналитика:** [`app/lib/billingCjmAnalytics.ts`](../../app/lib/billingCjmAnalytics.ts), дедуп `paywall_shown` / `checkout_opened` по `request_id` + screen.
