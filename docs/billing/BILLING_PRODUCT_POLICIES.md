# BoardIQ — зафиксированные продуктовые политики биллинга (UX Hardening)

Документ закрывает **§2.1** и **§2.2** плана `BILLING_UX_HARDENING_PLAN.md`. Юридическое утверждение — ответственность product/legal; в коде и enum отражены выбранные варианты.

## §2.1 Production policy: `no_subscription`

| Аспект | Решение |
|--------|---------|
| Режим для нового пользователя без подписки | **Hard block** боевых данных: нет боевых проектов, нет POST sync/OAuth к боевым кабинетам, нет тяжёлых отчётов по реальным данным (согласовано с архдоком §0). |
| Демо / sandbox | **Отдельный** продуктовый режим: `ReasonCode.BILLING_DEMO_MODE` и `ScreenId.DEMO_SHELL` (или эквивалент), только если явно включён флаг продукта; **не** смешивать с «пустым дашбордом = нули». |
| API | Доминирующий shell: `reason: BILLING_NO_SUBSCRIPTION`, `screen: PAYWALL` (кроме явного demo). |

## §2.2 Post-checkout onboarding

| Вопрос | Решение |
|--------|---------|
| Кто проходит полный 3-step flow | **Payer** с активной Paddle-подпиской, у которого не завершён `user_post_checkout_onboarding` (per `user_id`). |
| Invited user при оплаченной org | Полный блокирующий flow **не** требуется (`requires_post_checkout_onboarding: false` при entitlement / политике org). |
| Персист шагов | `user_post_checkout_onboarding.current_step` (1–3), `completed_at` идемпотентно; reload возвращает на тот же шаг. |
| Повторный показ | Нет после `completed_at`, кроме админского сброса / новой org / миграции. |

Поля API: `post_checkout_onboarding_step`, `onboarding_progress`, `requires_post_checkout_onboarding` (см. `/api/billing/current-plan`).
