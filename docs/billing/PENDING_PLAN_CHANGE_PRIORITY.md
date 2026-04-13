# Pending plan change — приоритет в resolver (§2.3 UX Hardening)

**Канон доступа и тарифов:** [BILLING_ACCESS_MODEL.md](./BILLING_ACCESS_MODEL.md).

Дополнение к основному архдоку (§28–§31): модель **A (overlay)**.

## Вставка в priority

После `paid_but_no_project` и **перед** применением обычного «зелёного» дашборда без оверлея:

- Если биллинг **зелёный** для смены плана (`active` / `trialing` / `canceled_until_end` без блокирующих unpaid/past_due/grace/no_subscription/refunded) и флаг `pending_plan_change === true`:
  - **`screen` остаётся `DASHBOARD`** (или текущий разрешённый shell).
  - **`reason: PLAN_CHANGE_PENDING`**, `blocking_level: soft`, баннер/оверлей «Обновляем тариф».
  - `allowed_actions` без sync/создания сущностей, зависящих от нового плана, до снятия флага или таймаута (10–15 с на клиенте).

## §13.1 Billing доминирует

Если биллинг **не** в «зелёном» окне для overlay смены плана (см. условие выше — в их числе **`no_subscription`**, т.к. нет активной paid-подписки для swap, а также **`unpaid`**, **`expired`**, **`past_due`**, **`grace_past_due`**, **`refunded`**, …), флаг `pending_plan_change` **не** должен показывать оверлей смены плана; в API он **сбрасывается** (`pending_plan_change: false`). Актуальные **`screen` / `reason`** берутся из **`billingShellResolver`**: для типичного Free это **`DASHBOARD` + `OK`**, а не PAYWALL и не сценарий «сначала оплатите подписку».

Реализация: `app/lib/billingShellResolver.ts` + колонка `billing_customer_map.pending_plan_change`.
