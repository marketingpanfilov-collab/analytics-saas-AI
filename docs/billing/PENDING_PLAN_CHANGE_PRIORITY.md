# Pending plan change — приоритет в resolver (§2.3 UX Hardening)

Дополнение к основному архдоку (§28–§31): модель **A (overlay)**.

## Вставка в priority

После `paid_but_no_project` и **перед** применением обычного «зелёного» дашборда без оверлея:

- Если биллинг **зелёный** для смены плана (`active` / `trialing` / `canceled_until_end` без блокирующих unpaid/past_due/grace/no_subscription/refunded) и флаг `pending_plan_change === true`:
  - **`screen` остаётся `DASHBOARD`** (или текущий разрешённый shell).
  - **`reason: PLAN_CHANGE_PENDING`**, `blocking_level: soft`, баннер/оверлей «Обновляем тариф».
  - `allowed_actions` без sync/создания сущностей, зависящих от нового плана, до снятия флага или таймаута (10–15 с на клиенте).

## §13.1 Billing доминирует

При **любом** «плохом» `access_state` (`unpaid`, `expired`, `past_due`, `grace_past_due`, `no_subscription`, `refunded`, …) флаг `pending_plan_change` **не** влияет на копирайт: показывается биллинговый reason/screen; в API флаг **сбрасывается** в ответе (`pending_plan_change: false`).

Реализация: `app/lib/billingShellResolver.ts` + колонка `billing_customer_map.pending_plan_change`.
