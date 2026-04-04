# CJM BILLING FINAL REPORT

## 1. Что реализовано

- **Inline pricing** ([`app/app/components/BillingInlinePricing.tsx`](../../app/app/components/BillingInlinePricing.tsx)): три тарифа, мес/год, CTA «Оплатить», Paddle, отмена / retry, **post-payment polling** (2.5s, до 22 попыток, wall-clock ~55s), панель «Платёж обрабатывается…» / «Статус ещё обновляется» + **«Обновить статус»** (single-flight `reloadBootstrap`).
- **Единый `isBillingBlocking`** + **`resolvePostPaymentRedirect`** + **origin_route** в [`app/lib/billingBootstrapClient.ts`](../../app/lib/billingBootstrapClient.ts): без дублирования веток screen/reason в polling и навигации.
- **`reloadBootstrap(): Promise<ResolvedUiStateV1 | null>`** + single-flight в [`BillingBootstrapProvider.tsx`](../../app/app/components/BillingBootstrapProvider.tsx); свежий `resolved_ui_state` после каждого await для polling.
- **Очистка маршрутов:** `clearBillingRouteStorage()` при logout (Topbar, shell gate), при **смене user id** и **SIGNED_OUT** (listener в провайдере).
- **Триггеры** ([`BillingPricingModalProvider.tsx`](../../app/app/components/BillingPricingModalProvider.tsx)): dashboard Full re-sync, ConnectSourcesModal, Weekly report Export — при блокировке и `isBillingBlocking` открывается одна модалка (guard от повторного open в read-only баннере).
- **Аналитика** [`app/lib/billingCjmAnalytics.ts`](../../app/lib/billingCjmAnalytics.ts): `paywall_shown`, `checkout_opened`, `checkout_success` / `checkout_cancel`, `upgrade_clicked`; дедуп по `request_id` + screen для paywall/checkout_opened.
- **Матрица аудита:** [`docs/billing/CJM_AUDIT_MATRIX.md`](CJM_AUDIT_MATRIX.md).

## 2. Обработка задержки webhook (webhook delay)

- После `checkout.completed` запускается цикл: `await reloadBootstrap()` → проверка `!isBillingBlocking(fresh)` приоритет №1; иначе до 22 итераций с паузой 2.5s; дополнительно таймаут ~55s.
- При исчерпании лимита при всё ещё блокирующем UI — текст + кнопка «Обновить статус» (тот же single-flight fetch).
- Двойной `checkout.completed`: флаг `postPaymentStartedRef` не даёт запустить второй цикл.
- Размонтирование компонента: инкремент `postPaymentGenRef` отменяет асинхронный цикл (без утечки таймеров в фоне).

## 3. Return flow после оплаты

- Перед открытием Paddle: `storeOriginRoute(pathname+search)` (валидация как у intended, с безопасным query).
- После unlock: `resolvePostPaymentRedirect(resolvedUi, { currentPath })` — приоритет **intended_route** → **origin_route** → `/app/projects` → `/app`; не использовать intended/origin при `isBillingBlocking === true`.
- Перед `router.push`: `validateBillingReturnPath`; затем `clearBillingRouteStorage()`.
- Не делается `push` на тот же URL, что уже открыт (сравнение через validate return path).

## 4. Триггеры (behavior)

- Паттерн: действие запрещено по `allowed_actions`, биллинг блокирует (`isBillingBlocking`), доступна оплата (`canOfferBillingInlinePricing`) → `requestBillingPricingModal(source_action)`.
- Точки: **sync_click** (дашборд Full re-sync), **oauth_connect_click** (ConnectSourcesModal), **export_click** (weekly report).
- Модалка read-only «Продлить доступ»: `setOpen` не открывает повторно, если уже открыта.

## 5. Аналитика

- Обязательные поля в payload: `plan`, `app_user_id`/`user_id`, `source_screen`, `source_reason`, `source_action`; опционально `billing_period`, `request_id`.
- GTM: `dataLayer.push` / `gtag` при наличии; иначе в dev или при `NEXT_PUBLIC_BILLING_DEBUG=1` — `console.debug`.

## 6. Риски

- Частые запросы при polling снижены single-flight и лимитами попыток.
- Конфликт с shell redirect: intended/origin очищаются после успешного post-payment redirect; глубина shell-редиректов по-прежнему ограничена `MAX_SHELL_REDIRECT_DEPTH`.
- При `null` bootstrap `isBillingBlocking(null) === true` — консервативно для редиректов до появления данных.

## 7. Ручная матрица QA (чеклист)

1. expired / unpaid → оплата  
2. over_limit → upgrade  
3. multi-tab  
4. cancel checkout  
5. webhook delay — виден processing + polling  
6. Оплата с `/app/ltv` → после unlock возврат по origin/intended  
7. Оплата с `/app/reports` → аналогично  
8. Оплата под blocked shell URL → fallback `/app/projects` или `/app`, не «тот же» blocked контекст  
9. intended валиден → приоритет над origin  
10. оба невалидны → `/app/projects` → `/app`  
11. нет redirect loop на тот же path  
12. max_attempts + «Обновить статус»; в Network нет параллельных `current-plan`  
13. двойной клик оплаты при открытом Paddle — второй checkout не открывается (`activeSession`)  
14. повторные клики по триггеру при открытой модалке — guard  
15. unmount во время polling — цикл останавливается (gen)  
16. после каждого tick свежий bootstrap в ответе  
17. двойной `checkout.completed` — один flow  
18. `paywall_shown` / `checkout_opened` без дублей при ре-рендерах  
19. logout / смена пользователя — intended + origin очищены  

## 8. Финальный статус

- **CJM READY:** YES (после прогона чеклиста в вашей среде).
- **PAYMENT FLOW READY:** YES при настроенных Paddle и рабочем `/api/billing/current-plan`.

### Проверено автоматически

- `npx tsc --noEmit` (в каталоге `app/`) — успешно.

### Документы

- Детальная матрица: [`CJM_AUDIT_MATRIX.md`](CJM_AUDIT_MATRIX.md).
