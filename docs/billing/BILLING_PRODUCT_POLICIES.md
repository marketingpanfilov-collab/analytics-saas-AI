# BoardIQ — зафиксированные продуктовые политики биллинга (UX Hardening)

**Актуальная модель доступа и тарифов (source of truth):** [BILLING_ACCESS_MODEL.md](./BILLING_ACCESS_MODEL.md).

**Инварианты доступа (обязательные при изменениях биллинга):** [BILLING_ACCESS_INVARIANTS.md](./BILLING_ACCESS_INVARIANTS.md).

Документ закрывает **§2.1** и **§2.2** плана `BILLING_UX_HARDENING_PLAN.md`. Юридическое утверждение — ответственность product/legal; в коде и enum отражены выбранные варианты.

## §2.1 Production policy: `no_subscription` (Free)

| Аспект | Решение |
|--------|---------|
| Семантика | **`no_subscription`** = нет активной подписки Paddle. Продуктовый слой трактует это как **Free**: в ответе bootstrap / `GET /api/billing/current-plan` выставляется **`experience_tier: "free"`** (`computeExperienceTier` в [`app/lib/billingExperienceTier.ts`](../../app/lib/billingExperienceTier.ts)), **`plan_feature_matrix`** — как у тарифа **free** (`resolvePlanFeatureMatrixForBillingGate` в [`app/lib/billingCurrentPlan.ts`](../../app/lib/billingCurrentPlan.ts)). |
| Shell / `resolved_ui_state` | **Не** hard **PAYWALL** по умолчанию. [`resolveBillingShell`](../../app/lib/billingShellResolver.ts): для типичного Free — **`ScreenId.DASHBOARD`**, **`reason: OK`**, **`allowed_actions`** с **`wildcard`**, в том числе пока **нет** ни орг-членства, ни проекта — пользователь остаётся в продукте и может создать первый проект в рамках лимитов Free. |
| Точка входа | Регистрация / подтверждение email: редирект в приложение через [`app/auth/callback/route.ts`](../../app/auth/callback/route.ts) с `safeAppNextTarget` и fallback **`/app/projects`**; на логине `emailRedirectTo` собирается с тем же контрактом `next` ([`LoginPageClient`](../../app/login/LoginPageClient.tsx)). **`/app/projects`** — нормальная часть Free flow, не признак paywall. |
| Ограничения возможностей | Тяжёлые отчёты, sync и т.д. режутся **матрицей Free** и серверными gates (`canReadAnalytics` / `canRunSync` в `billingExperienceTier.ts`, `requireBillingAccess`), а не полноэкранным «оформите подписку» для нового пользователя. |
| Что **не** является Free | **`unpaid`**, **`expired`**, **`paused`**, **`refunded`** — отдельные ветки resolver и API; в `canReadAnalytics` / `canRunSync` они **не** проходят как Free. |
| Демо / sandbox | **Отдельный** продуктовый режим: `ReasonCode.BILLING_DEMO_MODE` и `ScreenId.DEMO_SHELL`, только при явном demo-флаге; **не** смешивать с Free signup. |
| Контракт enum | `ScreenId.PAYWALL` и `ReasonCode.BILLING_NO_SUBSCRIPTION` остаются в [`billingUiContract`](../../app/lib/billingUiContract.ts) для UI/аналитики и краевых сценариев; **дефолтный** путь при **`access_state: no_subscription`** в resolver даёт **`OK`**, не **`BILLING_NO_SUBSCRIPTION`**. |

## §2.2 Post-checkout onboarding

| Вопрос | Решение |
|--------|---------|
| Кто проходит полный 3-step flow | **Payer** с активной Paddle-подпиской, у которого не завершён `user_post_checkout_onboarding` (per `user_id`). |
| Invited user при оплаченной org | Полный блокирующий flow **не** требуется (`requires_post_checkout_onboarding: false` при entitlement / политике org). |
| Персист шагов | `user_post_checkout_onboarding.current_step` (1–3), `completed_at` идемпотентно; reload возвращает на тот же шаг. |
| Повторный показ | Нет после `completed_at`, кроме админского сброса / новой org / миграции. |

Поля API: `post_checkout_onboarding_step`, `onboarding_progress`, `requires_post_checkout_onboarding` (см. `/api/billing/current-plan`).
