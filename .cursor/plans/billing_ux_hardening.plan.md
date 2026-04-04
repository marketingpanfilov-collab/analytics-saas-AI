---
name: BoardIQ Billing UX Hardening
overview: "План закрытия дыр в биллинге, CJM и UI: master contract, action matrix, routing, runtime, PLAN_CONFIG, §14 — resolved_ui-only, version, request_id, логи+dedup, client_safe_mode, no silent downgrade, redirect/retry, intended_route. Код в теле плана не пишется."
todos:
  - id: product-signoff-no-subscription
    content: §2.1 Утвердить production policy no_subscription (product/legal); при demo — отдельный reason/screen
    status: completed
  - id: product-signoff-post-checkout
    content: §2.2 Зафиксировать scope post-checkout (payer vs invite, per org/user, API поля завершения)
    status: completed
  - id: sync-main-arch-pending-plan
    content: §2.3 Влить pending_plan_change в priority resolver основного архдока (overlay vs fullscreen)
    status: completed
  - id: api-enums-contract
    content: §3 Reason/Screen/Action enums + resolved_ui_state в bootstrap API; клиент только рендер
    status: completed
  - id: billing-overrides-pending-change
    content: §13.1 Backend+UI — billing всегда приоритетнее pending_plan_change
    status: completed
  - id: client-fallback-bootstrap
    content: §13.2 fallback_ui_state (last_known + safe default read-only, без расширения прав)
    status: completed
  - id: action-matrix-align-gates
    content: §4 Согласовать action matrix с API gates; обновить при NO_ACCESS_TO_ORG
    status: completed
  - id: routing-deep-links
    content: §5 Политика deep links + intended_route для onboarding/unpaid/no project
    status: completed
  - id: resolver-no-access-to-org
    content: §13.4 Разделить NO_ACTIVE_PROJECT vs NO_ACCESS_TO_ORG в resolver и UI
    status: completed
  - id: over-limit-and-data-ui
    content: §6–§7 Over-limit детализация + data_state паттерны по виджетам
    status: completed
  - id: runtime-multitab-stabilization
    content: §13.3–§13.5 Multi-tab sync + stabilization window на клиенте
    status: completed
  - id: onboarding-progress-backend
    content: §13.6 Персист onboarding_progress (шаги 1–3) на backend
    status: completed
  - id: plan-config-enforcement
    content: §13.7 Единый PLAN_CONFIG / feature matrix с сервера; UI не дублирует лимиты
    status: completed
  - id: pre-impl-checklist-13-8
    content: §13.8 Пройти validation checklist перед мержем фазы контракта
    status: completed
  - id: contract-resolved-ui-version
    content: §14.2 Поле resolved_ui_state.version + проверка на клиенте; mismatch → fallback_ui_state
    status: completed
  - id: ui-no-raw-state-branching
    content: §14.1 Запрет ветвлений по access_state/onboarding_state/membership на UI; только resolved_ui_state
    status: completed
  - id: log-ui-state-transitions
    content: §14.3 Логирование log_ui_state_transition (прод-диагностика)
    status: completed
  - id: redirect-retry-intended-route
    content: §14.4–14.5–14.7 max_redirect_depth, retry bootstrap 1/3/5s, валидация intended_route
    status: completed
  - id: correlation-log-dedup-safe-mode
    content: §14.10–14.14 request_id, dedup логов, client_safe_mode, расширение логов, no silent downgrade
    status: completed
isProject: true
---

# BoardIQ Billing UX Hardening — Cursor Plan

**Полный исполняемый план** (контекст, gates, **таблица шагов 1–18**, mermaid, DoD) и **спецификация §1–§14** лежат в репозитории:

→ **[docs/BILLING_UX_HARDENING_PLAN.md](../../docs/BILLING_UX_HARDENING_PLAN.md)**

В том файле:

1. Раздел **«План внедрения»** — что делать и в каком порядке.
2. Раздел **«Спецификация»** — детальные таблицы и edge cases.

**Todos** дублируются в YAML выше и в начале `docs/BILLING_UX_HARDENING_PLAN.md` — при изменении списка задач обновляйте **оба** места (или оставьте один источник правды и копируйте в другой).

**Связанный архдок:** `boardiq_billing_subscription_lifecycle_64247266.plan.md` в этой же папке `.cursor/plans/`.
