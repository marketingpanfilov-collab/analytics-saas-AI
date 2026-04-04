# Validation checklist §13.8 (Billing UX Hardening)

Использовать перед мержем фазы контракта и после значимых изменений resolver / bootstrap.

- [ ] Все состояния priority resolver покрыты тест-кейсами (включая `pending_plan_change`, §13.1).
- [ ] Нет конфликтов resolver: явная цепочка «первый истинный» + billing доминирует над plan change.
- [ ] Все `ReasonCode` из контракта имеют использование в API/resolver или помечены как client-only (`BOOTSTRAP_UNAVAILABLE`).
- [ ] Экраны `ScreenId` сопоставлены с продуктовым Screen Map.
- [ ] Action matrix (`docs/billing/ACTION_MATRIX.md`) согласована с `requireBillingAccess` и project gates.
- [ ] Fallback §13.2 и стабилизация §13.5 описаны в QA-сценариях (двойное подтверждение, refund immediate).
- [ ] Multi-tab: ручной сценарий с `BroadcastChannel` + повтор bootstrap.
- [ ] §14.1: shell и gating на клиенте опираются на `resolved_ui_state`, не на сырые `access_state` / `onboarding_state`.
- [ ] §14.2: проверка `version === v1`; mismatch → last_known или safe default.
- [ ] §14.3: `logBillingUiTransition` с `request_id`, `version`, `source`; дедуп ~4s (`app/lib/logBillingUiTransition.ts`).
- [ ] §14.4–14.7: `max_redirect_depth`, retry 1s/3s/5s, валидация `intended_route` (`billingBootstrapClient.ts`).
- [ ] §14.10–14.14: `request_id` в ответе bootstrap; `client_safe_mode` после исчерпания retry; выход из safe mode после двух успешных bootstrap; нет тихого ухудшения без отображаемой причины.
