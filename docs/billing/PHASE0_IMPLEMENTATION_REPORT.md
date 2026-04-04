# Phase 0 implementation report (Billing System Execution Plan)

Дата: по завершении прохода Phase 0. Основа: [BILLING_SYSTEM_EXECUTION_PLAN.md](../BILLING_SYSTEM_EXECUTION_PLAN.md).

## 1. Что реализовано (по ID)

- **P0-SEC-01** — `POST .../meta/connections/upsert`: сессия, `requireProjectAccessOrInternal`, `billingHeavySyncGateBeforeProject` (порядок billing → project), затем admin upsert.
- **P0-SEC-02 / P0-SEC-03** — инвентаризация и закрытие критичных пробелов: см. [PHASE0_API_ROUTE_INVENTORY.md](PHASE0_API_ROUTE_INVENTORY.md); исправлены открытые list/upsert/campaigns sync.
- **P0-SEC-04** — единый heavy-паттерн: user-путь на sync/dashboard/refresh/oauth insights/meta campaigns/intent/sync_run с pre-check billing; internal — по-прежнему `requireProjectAccessOrInternal` + secret.
- **P0-CON-01** — `isCompleteResolvedUiStateV1` + проверка в `assembleBillingPayload`; при нарушении контракта возвращается `{ success: false }` вместо «полу-успеха».
- **P0-CON-02** — клиент: `isBootstrapResponseValid` расширен (`pending_plan_change`, `intended_route`); несовпадение `version` по-прежнему даёт reject JSON → fallback/retry.
- **P0-CON-03** — убран `rawResolvedUi` из контекста; shell потребляет только `resolvedUi`; комментарий в типе контекста.
- **P0-LOG-01** — `billingHeavySyncGateBeforeProject` / `billingAnalyticsReadGateBeforeProject`; применён на перечисленных маршрутах **до** проверки project (кроме internal, где pre-check пропускается); комментарий в `billingShellResolver`.
- **P0-UX-01** — Topbar: тариф из `plan_feature_matrix` при наличии; `isMaxPlan` только при agency + безлимиты в матрице (источник с сервера).
- **P0-RUN-01** — `capResolvedUiNeverExpand` для last-known при ошибке bootstrap; исправлена логика stabilization (не понижать `blocking_level` при новом fetch); при использовании last-known включается `clientSafeMode`.

## 2. Изменённые файлы

- `app/lib/auth/requireProjectAccessOrInternal.ts`
- `app/lib/auth/requireBillingAccess.ts`
- `app/lib/billingUiContract.ts`
- `app/lib/billingCurrentPlan.ts`
- `app/lib/billingShellResolver.ts`
- `app/lib/billingBootstrapClient.ts`
- `app/api/oauth/meta/connections/upsert/route.ts`
- `app/api/oauth/meta/connections/list/route.ts`
- `app/api/oauth/meta/connections/save/route.ts`
- `app/api/oauth/google/connections/save/route.ts`
- `app/api/oauth/tiktok/connections/save/route.ts`
- `app/api/oauth/meta/insights/sync/route.ts`
- `app/api/oauth/google/insights/sync/route.ts`
- `app/api/oauth/tiktok/insights/sync/route.ts`
- `app/api/oauth/meta/campaign-marketing-intent/sync/route.ts`
- `app/api/oauth/meta/campaigns/route.ts`
- `app/api/oauth/meta/campaigns/sync/route.ts`
- `app/api/dashboard/sync/route.ts`
- `app/api/dashboard/refresh/route.ts`
- `app/api/sync/run/route.ts`
- `app/api/billing/current-plan/route.ts`
- `app/app/components/BillingBootstrapProvider.tsx`
- `app/app/components/Topbar.tsx`
- `docs/billing/PHASE0_API_ROUTE_INVENTORY.md` (новый)
- `docs/billing/PHASE0_IMPLEMENTATION_REPORT.md` (этот файл)

## 3. Суть исправлений

- Устранён анонимный write в `meta_connections`; закрыт анонимный read списка подключений Meta; закрыты анонимные Meta Graph list/sync кампаний (`campaigns`, `campaigns/sync`).
- Тяжёлые sync-пути для пользователя сначала проверяют биллинг (402), затем членство в проекте; internal cron остаётся на secret + project gate.
- Ответ bootstrap гарантированно содержит полный v1 `resolved_ui_state` или ошибку 500 без «успеха без поля».
- Клиент не расширяет доступ при дребезге state и при восстановлении из last-known после сбоя.

## 4. Проверено

- `npx tsc --noEmit` (в каталоге `app/`) — OK.
- `npm run build` — OK.

Ручные HTTP-проверки в этом проходе не выполнялись (нет e2e стенда в задаче).

## 5. Не закрыто / вне Phase 0

- Полный автоматический скан **всех** `app/api/**` на предмет будущих эндпоинтов.
- Остальные OAuth read-only маршруты (`meta/accounts`, `google/accounts`, …) — не пересматривались пакетно; при появлении PII без gate — отдельный тикет.
- Рефакторинг `loadBillingCurrentPlan` для физического порядка запросов БД (billing до membership) не делался: семантика shell уже billing-first в resolver.

## 6. Риски / follow-up

- `POST /api/sync/run` с internal secret: pre-check billing пропускается; защита остаётся на downstream GET insights (internal + project). При прямом вызове sync/run только с secret без user — убедиться, что такой вызов не экспонируется в браузер.
- После удаления `rawResolvedUi` при появлении отладочных сценариев использовать логи сервера / `request_id`.
