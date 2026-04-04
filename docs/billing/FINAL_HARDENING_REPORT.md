# FINAL HARDENING REPORT — Phase 2 & 3 (BoardIQ Billing)

## 1. Что реализовано (Phase 2)

### 1.1 `allowed_actions` / `billingActionAllowed`

- **Дашборд:** `POST /api/dashboard/refresh`, full re-sync, `POST /api/system/update-rates` — только при `ActionId.sync_refresh` (`AppDashboardClient.tsx`).
- **Meta Connect modal:** подключение кабинета и sync — `sync_refresh` (`ConnectSourcesModal.tsx`).
- **Аккаунты (Meta/Google/TikTok):** сохранение выбора, sync all/one, disconnect — `guardIntegrationWrite()` → `sync_refresh` (`AccountsPageClient.tsx`). OAuth-редирект (start) не блокируется.
- **Отчёты:** загрузка summary + update-rates — `navigate_app` / `sync_refresh` и ранний выход при `reportsPack.state === "BLOCKED"` (`ReportsPageClient.tsx`).

Интеграции, не перечисленные выше (pixels, weekly-report export, utm-builder, settings POST и т.д.), по-прежнему должны проходить тот же паттерн при следующем аудите.

### 1.2 Data states (EMPTY / LIMITED / BLOCKED)

- Общий модуль `app/lib/billingWidgetState.ts`: `resolveDashboardWidgetState`, `resolveLtvWidgetState`, `resolveReportsWidgetState` — только из `resolved_ui_state` + `plan_feature_matrix` (без `access_state` в UI).
- Компонент `BillingWidgetPlaceholder.tsx`.
- **Дашборд:** баннер LIMITED/BLOCKED, график заменён на placeholder при BLOCKED; блоки атрибуции скрыты при BLOCKED или при `attribution_heavy === false` (Starter) с LIMITED-плейсхолдером.
- **LTV:** BLOCKED — отдельный экран + не дергаем API; LIMITED — баннер; обработка `BILLING_BLOCKED` в ответе API.
- **Отчёты:** BLOCKED — полноэкранный placeholder; LIMITED — баннер над контентом; `BILLING_BLOCKED` в JSON отчёта.

### 1.3 Raw state в UI

- В `app/app` нет ветвлений по `access_state` / `onboarding_state` (grep). Post-checkout использует `onboarding_progress` / `plan_feature_matrix` из bootstrap (продуктовые поля API, не shell-логика).

### 1.4 Over-limit

- `BillingShellGate`: список `over_limit_details`, пояснение, кнопки навигации: Проекты, Команда орг., Рекл. аккаунты + существующие CTA (подписка / настройки).

### 1.5 Onboarding persistence

- `POST /api/billing/post-checkout-onboarding`: перед `advance_step`, `save_company`, `complete` — проверка `loadBillingCurrentPlan` → `requires_post_checkout_onboarding`; иначе **403** (нельзя продвинуть/завершить вне активного onboarding).

### 1.6 Баннер «no silent downgrade»

- `BillingAccessStricterBanner`: текст с человекочитаемой причиной по `ReasonCode` + `request_id`.

---

## 2. Phase 3 — сценарии и проверки

| # | Сценарий | Ожидание | Проверка в коде / вручную |
|---|----------|----------|-------------------------|
| 1 | Новый без оплаты | Paywall / gate | Shell gate + bootstrap |
| 2–3 | Onboarding 3 шага, reload | Тот же шаг, API 403 без активного onboarding | Post-checkout gate + modal step из progress |
| 4 | Paid, нет проекта | NO_PROJECT | Resolver (Phase 0/1) |
| 5–6 | Invite / timeout | INVITE_* | Resolver (Phase 1) |
| 7–8 | Unpaid / pending plan | Read-only / баннер | UI states + баннеры |
| 9 | Downgrade / over-limit | Fullscreen + список | Gate + детали |
| 10 | Refund | Hard gate | Resolver |
| 11 | Multi-tab | Broadcast | Provider (Phase 1) |
| 12 | Fallback / safe mode | Ограниченные действия | capResolvedUi (Phase 0/1) |
| 13 | No org | NO_ORG | Gate |
| 14 | Grace | LIMITED в виджетах | `billingWidgetState` |
| 15 | Version mismatch | Fallback валидации bootstrap | `isBootstrapResponseValid` |

**Автотесты E2E** в репозитории не добавлялись; финальная приёмка — ручной прогон по таблице выше на staging.

---

## 3. Технические проверки (чеклист)

- [x] Heavy sync / refresh на дашборде согласованы с `sync_refresh`.
- [x] Интеграции accounts: мутации за `sync_refresh`.
- [x] Отчёт: клиентский gate + `BILLING_BLOCKED` с API.
- [x] UI shell: нет `access_state` в `app/app` для экранов.
- [x] Fallback не расширяет доступ (без изменений Phase 0/1).
- [ ] Полный проход инвентаризации «все POST в app» — см. остаточные риски.

---

## 4. Найденные проблемы и исправления

- **Проблема:** API post-checkout можно было вызывать без активного onboarding. **Исправление:** серверная проверка `requires_post_checkout_onboarding`.
- **Проблема:** `connectTikTok` блокировал OAuth-редирект. **Исправление:** guard только на ветку POST discover.
- **Проблема:** деградация доступа без явной причины в баннере. **Исправление:** `REASON_HUMAN` + `request_id`.

---

## 5. Остаточные риски

- **Другие страницы** (pixels, weekly-report, utm-builder, conversion-data, экспорты): не все POST/CTA обёрнуты в `billingActionAllowed`; серверные гейты остаются источником правды — возможны «кнопка активна → 402/403» до полного покрытия.
- **export** (`ActionId.export`): не везде проведён (нет единого export в Marketing Summary UI как отдельной кнопки в текущем diff).
- **N+1** на инвайтах в `billingCurrentPlan` (Phase 1) без изменений.

---

## 6. Финальный статус

```text
READY FOR PRODUCTION: NO
```

**Обоснование:** критичный продуктовый контур (дашборд, отчёты, LTV, аккаунты, connect modal, post-checkout) усилен и согласован с `allowed_actions` и data states; полный охват всех CTA/экспортов/OAuth-путей и ручной CJM на staging ещё нужно закрыть перед «да».

После ручного прогона 15 сценариев и добивки оставшихся маршрутов:

```text
READY FOR PRODUCTION: YES
```

(по решению product/QA).
