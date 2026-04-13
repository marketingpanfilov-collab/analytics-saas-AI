# BoardIQ — модель доступа и тарифов (canonical)

**Единственный актуальный source of truth** по `access_state`, Free vs paid, shell и bootstrap. Детальные отчёты фаз и CJM — исторический контекст; при расхождении приоритет у этого файла и кода.

**Обязательные инварианты** (не нарушать при правках биллинга): [BILLING_ACCESS_INVARIANTS.md](./BILLING_ACCESS_INVARIANTS.md).

**Код:** `app/lib/accessState.ts`, `app/lib/billingExperienceTier.ts`, `app/lib/billingShellResolver.ts`, `app/lib/billingCurrentPlan.ts`, `app/lib/billingBootstrapClient.ts`, `app/lib/auth/requireBillingAccess.ts`, `app/auth/callback/route.ts`, `app/login/LoginPageClient.tsx`.

---

## 1. `access_state` vs `experience_tier`

| Поле | Источник | Назначение |
|------|----------|------------|
| **`access_state`** | Paddle / подписка / entitlement → `resolveAccessState` | Жизненный цикл оплаты и провайдера: `no_subscription`, `active`, `trialing`, `past_due`, `grace_past_due`, `unpaid`, `paused`, `canceled_until_end`, `expired`, `refunded`. |
| **`experience_tier`** | `computeExperienceTier` в `billingExperienceTier.ts` | Продуктовый слой поверх Paddle: сейчас только **`"free"`** или **`null`**. **`"free"`** выставляется при **`access_state === "no_subscription"`** (и не в demo). Поля орг/проекта в функции **не** ограничивают Free — tier совпадает с «нет подписки Paddle». |

Bootstrap (`GET /api/billing/current-plan`) отдаёт оба поля; UI и клиент опираются на **`resolved_ui_state`** из resolver и на матрицу фич.

---

## 2. Когда пользователь считается Free

- **`access_state === "no_subscription"`** (нет строки подписки Paddle в биллинг-контексте или эквивалент «нет подписки»).
- Тогда **`experience_tier === "free"`** (кроме demo-режима).
- **`plan_feature_matrix`** = матрица **`free`**, если `effective_plan` не задаёт paid slug, через `resolvePlanFeatureMatrixForBillingGate` (ветка `experience_tier === "free"`).

**`effective_plan`** при отсутствии подписок: в `loadBillingCurrentPlan` для `no_subscription` — **`"free"`**, если есть **`has_org_membership` или `has_any_accessible_project`**, иначе **`null`**. Даже при **`effective_plan: null`** у новичка матрица остаётся **free**, пока сработала ветка по **`experience_tier`**.

---

## 3. Когда пользователь попадает в PAYWALL

- В **`resolveBillingShell`** экран **`ScreenId.PAYWALL` в текущей реализации не возвращается** (ветка для «нет подписки = paywall» снята).
- **`ScreenId.PAYWALL`** и **`ReasonCode.BILLING_NO_SUBSCRIPTION`** остаются в **`billingUiContract`** и в **`BillingShellGate`** / аналитике на случай совместимости и редких путей; **типичный Free с `no_subscription` получает `DASHBOARD` + `reason: OK`**, не PAYWALL.
- **`isBillingBlocking`** в `billingBootstrapClient.ts` по-прежнему трактует **`PAYWALL`** как блокирующий shell, если такой screen когда-либо придёт с сервера.

---

## 4. Когда действует READ_ONLY

- Resolver отдаёт **`READ_ONLY_SHELL`** при **`access_state === "unpaid"`** или **`expired`** (reason `BILLING_UNPAID` / `BILLING_EXPIRED`, `data_state_default: BLOCKED`), и при **`paused`** (тот же жёсткий read-only по продуктовой политике, reason в контракте через unpaid-ветку).
- **`isBillingBlocking`** для **`READ_ONLY_SHELL`** включает блокировку только если reason входит в **`BILLING_UNPAID` / `BILLING_EXPIRED` / `BILLING_PAST_DUE`** (см. `READ_ONLY_BILLING_PAYMENT_REASONS` в `billingBootstrapClient.ts`).

**Чтение аналитики (GET):** `canReadAnalytics` — **`false`** для **`refunded`**, **`unpaid`**, **`expired`**, **`paused`**; для **`no_subscription`** — только если **`experience_tier === "free"`** (для Free это так).

---

## 5. `/app/projects` для нового пользователя

- После регистрации / подтверждения email редирект строится с **`safeAppNextTarget`** и fallback **`/app/projects`** (`auth/callback/route.ts`, `buildEmailConfirmRedirectUrl` + `nextPath` на логине).
- Пользователь с **`no_subscription`** без орг и без проекта получает в resolver **`DASHBOARD` + `OK` + `wildcard`** — не hard paywall и не «сначала оплата»; список проектов — нормальная точка входа во Free flow до создания первого проекта.

---

## 6. Bootstrap: `effective_plan` и `plan_feature_matrix`

- **`loadBillingCurrentPlan`** поднимает подписки Paddle / entitlement, считает **`access_state`**, **`has_org_membership`**, **`has_any_accessible_project`**, **`primary_org_id`**, при необходимости over-limit по матрице.
- **`effective_plan`**: из slug тарифа Paddle / entitlement (`starter` | `growth` | `scale`), виртуальный **`free`** при отсутствии Paddle но участии в продукте (орг/проект), иначе при «чистом» no_subscription может быть **`null`** до первой орг/проекта.
- **`experience_tier`**: `computeExperienceTier` от **`access_state`** (и demo).
- **`plan_feature_matrix`**: `resolvePlanFeatureMatrixForBillingGate({ effective_plan, experience_tier })` — paid slug → его матрица; иначе **`free`** при `effective_plan === "free"` или **`experience_tier === "free"`**; иначе **`unknown`**.

---

## 7. Free vs `unpaid` / `expired` / `paused`

| | Free (`no_subscription`) | `unpaid` / `expired` / `paused` |
|--|--------------------------|----------------------------------|
| Подписка Paddle | Нет (ни была, ни в «просроченном» смысле продукта) | Была / есть запись в проблемном статусе |
| **`experience_tier`** | **`free`** | **`null`** |
| Типичный shell | **`DASHBOARD`**, **`OK`** | **`READ_ONLY_SHELL`** (unpaid/expired/paused) |
| **`canReadAnalytics`** | Да (при `free`) | Нет |
| **`canRunSync`** | Да | Нет |

---

## 8. Сводная таблица сценариев

Условные «доступ к данным» / «sync» — по **`canReadAnalytics`** / **`canRunSync`** для пользовательских маршрутов (не internal/cron).

| Сценарий | `experience_tier` | Типичный shell (`screen` / `reason`) | Доступ к данным (read) | Sync (heavy POST) |
|----------|-------------------|----------------------------------------|-------------------------|-------------------|
| Free, нет подписки (`no_subscription`) | `free` | `DASHBOARD` / `OK` | Да | Да |
| Paid: `active` / `trialing` / `canceled_until_end` | `null` | `DASHBOARD` / `OK` (или `NO_PROJECT` / over-limit и т.д.) | Да | Да |
| `past_due` / `grace_past_due` | `null` | `DASHBOARD` + soft billing reason | Да | Нет (в `canRunSync` не входят в «зелёное» окно; только active/trialing/canceled_until_end или `free`) |
| `unpaid` / `expired` | `null` | `READ_ONLY_SHELL` | Нет | Нет |
| `paused` | `null` | `READ_ONLY_SHELL` | Нет | Нет |
| `refunded` | `null` | `BILLING_REFUNDED` | Нет | Нет |
| Over limit | — | `OVER_LIMIT_FULLSCREEN` | По маршрутам/gates | По `canRunSync` |
| Post-checkout onboarding | — | `POST_CHECKOUT_MODAL` | По модалке | Ограничено |
| Invite pending / timeout | — | `INVITE_LOADING` / `INVITE_FALLBACK` | Нет | Нет |
| Нет орг/проекта, **не** `no_subscription` | — | `NO_ORG_ACCESS` | Нет | Нет |
| PAYWALL | — | Не выдаётся текущим resolver’ом | — | — |

---

## Обновление документа

При изменении `resolveBillingShell`, `computeExperienceTier`, `canReadAnalytics` / `canRunSync` или сборки payload в `loadBillingCurrentPlan` — обновить этот файл в том же PR. Если меняется продуктовая политика доступа — синхронизировать [BILLING_ACCESS_INVARIANTS.md](./BILLING_ACCESS_INVARIANTS.md).
