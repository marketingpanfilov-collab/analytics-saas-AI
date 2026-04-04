# Billing System Execution Plan (BoardIQ)

**Назначение:** исполняемый roadmap для доведения биллинга, lifecycle, UI-гейтинга и runtime-устойчивости до production-ready.  
**Ограничения:** этот документ не заменяет архитектурные спецификации и чеклисты; на них даются ссылки. Код здесь не приводится.

**База (результаты аудита и спеки — только как контекст):**

- Критичный обход: отсутствие auth на write в Meta connections — [`app/api/oauth/meta/connections/upsert/route.ts`](app/api/oauth/meta/connections/upsert/route.ts) (сравнить с паттерном [`app/api/oauth/meta/connections/save/route.ts`](app/api/oauth/meta/connections/save/route.ts)).
- Общие отчёты по backend/data — например [`docs/BACKEND_AUDIT_REPORT.md`](BACKEND_AUDIT_REPORT.md), [`docs/BACKEND_HARDENING_REPORT.md`](BACKEND_HARDENING_REPORT.md).
- Контракт UX / §14 — [`docs/BILLING_UX_HARDENING_PLAN.md`](BILLING_UX_HARDENING_PLAN.md), матрица действий — [`docs/billing/ACTION_MATRIX.md`](billing/ACTION_MATRIX.md), чеклист — [`docs/billing/BILLING_UX_VALIDATION_CHECKLIST.md`](billing/BILLING_UX_VALIDATION_CHECKLIST.md), политики — [`docs/billing/BILLING_PRODUCT_POLICIES.md`](billing/BILLING_PRODUCT_POLICIES.md).
- Серверные гейты — [`app/lib/auth/requireBillingAccess.ts`](../app/lib/auth/requireBillingAccess.ts), [`app/lib/auth/requireProjectAccessOrInternal.ts`](../app/lib/auth/requireProjectAccessOrInternal.ts), resolver/UI-контракт — модули `app/lib/billingShellResolver.ts`, `app/lib/billingUiContract.ts`, `app/lib/billingBootstrapClient.ts`, `app/lib/logBillingUiTransition.ts` (по мере внедрения).

---

## Цель и критерии «готово к продакшену»

1. Устранены все **Critical** и **Major** пункты аудита, относящиеся к биллингу, доступу, обходам API и расхождению UI/backend.
2. **Единый контракт:** `resolved_ui_state` — единственный источник правды для shell UI; версионирование; на клиенте нет бизнес-ветвлений по сырым осям состояния.
3. **Порядок доступа:** сначала billing/org eligibility, затем project access; действия согласованы с **action matrix** и **allowed_actions**.
4. **Runtime:** предсказуемый fallback (без расширения прав), multi-tab, стабилизация, retry, `request_id`, логирование без шума (dedup).
5. **Продуктовые состояния** закрыты согласованным UI: post-checkout, invite, `NO_ACCESS_TO_ORG`, over-limit, unpaid/grace, pending plan change — без «тихого» ухудшения UX.

---

## Карта фаз и зависимостей

| Фаза | Фокус | Жёсткие зависимости |
| ---- | ----- | ------------------- |
| **0** | Безопасность, контракт, отсутствие обходов | Старт первой; блокирует rollout |
| **1** | Стабильность, sync, runtime | После P0-задач по контракту и auth на критичных write |
| **2** | Полнота UX/CJM в UI | После наличия стабильного bootstrap + `allowed_actions` в API |
| **3** | QA и валидация | После завершения P0–P2 по scope релиза |

**Параллельные дорожки (после разблокировки P0):**

- **Track A (backend):** инвентаризация API → гейты → ответы с `resolved_ui_state` / `request_id`.
- **Track B (frontend):** shell по контракту, удаление raw-branching, data states.
- **Track C (product/QA):** сценарии CJM, копирайт баннеров/экранов, приёмка.

**Строго последовательно:**

1. Закрытие критичных unauthenticated / bypass **до** масштабного рефакторинга UI.
2. Контракт API (`resolved_ui_state`, version) **до** полного перевода экранов на него.
3. `fallback_ui_state` и политика «не расширять доступ» **до** включения агрессивного retry в проде.

---

## Phase 0 — Critical fixes (обязательны до rollout)

Фокус: безопасность, контракт, отсутствие обходов.

### [P0-SEC-01] Закрыть unauthenticated write: Meta `connections/upsert`

- **Слой:** backend  
- **Описание:** Маршрут POST без проверки сессии/проекта позволяет upsert в `meta_connections` при знании `project_id` / `integration_id` / `ad_account_id`. Привести к тому же уровню защиты, что и `connections/save`: сессия, проверка доступа к проекту, billing heavy gate где применимо.  
- **Где:** [`app/api/oauth/meta/connections/upsert/route.ts`](../app/api/oauth/meta/connections/upsert/route.ts); вызывающий код — например [`app/app/components/ConnectSourcesModal.tsx`](../app/app/components/ConnectSourcesModal.tsx).  
- **Зависимости:** нет.  
- **Риск если не сделать:** компрометация привязок рекламных кабинетов к проектам, обход org/billing.  
- **Приоритет:** P0  
- **DoD:** запрос без валидной авторизации и доступа к `project_id` → 401/403; успешный upsert только для того же пользователя/правил, что и `save`; нет регрессии в UI connect flow.
- **Owner:** backend  
- **Effort:** S  

### [P0-SEC-02] Инвентаризация API: все write / heavy / PII маршруты

- **Слой:** backend / product  
- **Описание:** Таблица всех route handlers с методами POST/PUT/PATCH/DELETE и «тяжёлыми» GET (sync, refresh, export). Отметить: auth, project gate, billing gate, internal bypass.  
- **Где:** `app/api/**/route.ts` (автоматизация — скрипт/таблица в тикет-системе, ссылка в PR).  
- **Зависимости:** нет.  
- **Риск:** неполное покрытие → оставшиеся обходы после «мы всё закрыли».  
- **Приоритет:** P0  
- **DoD:** документ/таблица в трекере; явный список исключений (cron/internal) с обоснованием.
- **Owner:** product  
- **Effort:** M  

### [P0-SEC-03] Аудит маршрутов без billing gate (после project access)

- **Слой:** backend  
- **Описание:** Для маршрутов, где уже есть `requireProjectAccessOrInternal`, проверить наличие `requireBillingAccess` / `billingHeavySyncGateFromAccess` / `requireBillingAnalyticsReadForUser` по типу операции (тяжёлый sync, отчёты, ingest). Устранить расхождения с [`docs/billing/ACTION_MATRIX.md`](billing/ACTION_MATRIX.md).  
- **Где:** пары [`app/lib/auth/requireBillingAccess.ts`](../app/lib/auth/requireBillingAccess.ts) + затронутые `app/api/**`.  
- **Зависимости:** P0-SEC-02.  
- **Риск:** оплаченный UI при фактическом `BILLING_BLOCKED` на сервере или наоборот.  
- **Приоритет:** P0  
- **DoD:** каждый heavy/analytics route в инвентаризации имеет YES/NO и ссылку на строку кода gate.
- **Owner:** backend  
- **Effort:** L  

### [P0-SEC-04] Защита heavy sync единообразно

- **Слой:** backend  
- **Описание:** Все entrypoints sync/refresh/oauth insights, создающие нагрузку или тянущие данные, проходят heavy sync gate; internal/cron — явно помечены bypass.  
- **Где:** `app/api/oauth/*/insights/sync`, `app/api/dashboard/sync`, `app/api/sync/run`, и т.д.  
- **Зависимости:** P0-SEC-02, P0-SEC-03.  
- **Риск:** обход оплаты через альтернативный endpoint.  
- **Приоритет:** P0  
- **DoD:** нет расхождений между «кнопкой в UI» и «прямым вызовом API» для sync.
- **Owner:** backend  
- **Effort:** L  

### [P0-CON-01] `resolved_ui_state` всегда в ответе bootstrap / current-plan агрегата

- **Слой:** backend  
- **Описание:** Любой клиентский bootstrap, от которого строится shell, возвращает непротиворечивый объект `resolved_ui_state` (screen, reason, `allowed_actions`, `blocking_level`, и т.д. по контракту). Отсутствие поля = блокер.  
- **Где:** агрегирующие API биллинга/плана + resolver.  
- **Зависимости:** согласование полей с [`docs/BILLING_UX_HARDENING_PLAN.md`](BILLING_UX_HARDENING_PLAN.md) / [`app/lib/billingUiContract.ts`](../app/lib/billingUiContract.ts).  
- **Риск:** клиент «угадывает» состояние.  
- **Приоритет:** P0  
- **DoD:** контрактные тесты или контрактные фикстуры JSON; 400/503 не отдают «полу-успех» с пустым shell.
- **Owner:** backend  
- **Effort:** L  

### [P0-CON-02] Версионирование контракта (`resolved_ui_state.version`)

- **Слой:** backend + frontend  
- **Описание:** Поле `version`; клиент при mismatch не интерполирует новые reason — уходит в `fallback_ui_state` (см. Phase 1).  
- **Где:** ответ API + клиентский bootstrap.  
- **Зависимости:** P0-CON-01.  
- **Риск:** поломка прод при добавлении reason без миграции клиента.  
- **Приоритет:** P0  
- **DoD:** задокументирован текущий `v1`; при несовпадении — предсказуемое поведение без crash.
- **Owner:** fullstack  
- **Effort:** M  

### [P0-CON-03] Запрет raw state branching на frontend (policy + линт/ревью)

- **Слой:** frontend / process  
- **Описание:** Запрет условий рендера shell от `access_state` / `onboarding_state` / membership в обход `resolved_ui_state`. Исключения только для отладки за feature flag.  
- **Где:** `app/app/**` layout, topbar, billing providers.  
- **Зависимости:** P0-CON-01.  
- **Риск:** двойная логика и рассинхрон с backend.  
- **Приоритет:** P0  
- **DoD:** чеклист в PR; по возможности ESLint/custom rule на запрещённые импорты/паттерны (если внедряется).
- **Owner:** frontend  
- **Effort:** M  

### [P0-LOG-01] Порядок резолвинга: billing → project access

- **Слой:** backend  
- **Описание:** Resolver и API гейты отражают приоритет: сначала биллинговая пригодность org/user к действию, затем наличие/доступ к проекту. Согласовать с action matrix.  
- **Где:** resolver + `requireBillingAccess` + project guards.  
- **Зависимости:** P0-CON-01.  
- **Риск:** пользователь видит проект, но не должен; или блокируется на paywall при валидном invite.  
- **Приоритет:** P0  
- **DoD:** таблица приоритетов в коде/комментарии + 1 тест на конфликт «проект есть, billing нет».
- **Owner:** backend  
- **Effort:** M  

### [P0-UX-01] Feature matrix → UI (минимум: не показывать недоступное как полное)

- **Слой:** frontend + backend  
- **Описание:** Лимиты/фичи с сервера (`PLAN_CONFIG` / feature matrix) определяют видимость и режим виджетов; UI не хардкодит лимиты, расходящиеся с API.  
- **Где:** `app/lib/planConfig.ts` и потребители.  
- **Зависимости:** P0-CON-01.  
- **Риск:** «тихий» обрез данных или ложное ощущение полного тарифа.  
- **Приоритет:** P0  
- **DoD:** чеклист виджетов с указанием источника лимита.
- **Owner:** fullstack  
- **Effort:** M  

### [P0-RUN-01] `fallback_ui_state` не расширяет доступ

- **Слой:** frontend  
- **Описание:** При ошибке bootstrap последнее известное состояние или safe read-only default; запрет sync/billing_manage при неопределённости.  
- **Где:** `app/lib/billingBootstrapClient.ts`, провайдеры layout.  
- **Зависимости:** P0-CON-01.  
- **Риск:** кратковременное открытие действий без оплаты.  
- **Приоритет:** P0  
- **DoD:** сценарий в Phase 3 обязателен; нет успешного heavy POST при fallback «ошибка сети».
- **Owner:** frontend  
- **Effort:** M  

---

## Phase 1 — Consistency & stability

Фокус: стабильность, синхронизация, runtime.

### [P1-RUN-01] Multi-tab sync состояния биллинга/UI

- **Слой:** frontend  
- **Описание:** При смене `resolved_ui_state` в одной вкладке остальные получают сигнал (например `BroadcastChannel`) и перезагружают bootstrap без полного reload.  
- **Где:** billing bootstrap provider / client.  
- **Зависимости:** P0-CON-01.  
- **Риск:** одна вкладка в unpaid, другая в active.  
- **Приоритет:** P1  
- **DoD:** ручной сценарий из чеклиста §13.8.
- **Owner:** frontend  
- **Effort:** M  

### [P1-RUN-02] Retry bootstrap: 1s / 3s / 5s + исчерпание

- **Слой:** frontend  
- **Описание:** Ограниченное число попыток; далее `client_safe_mode` по политике §14.  
- **Где:** `billingBootstrapClient.ts`.  
- **Зависимости:** P0-RUN-01.  
- **Риск:** бесконечный шторм запросов.  
- **Приоритет:** P1  
- **DoD:** метрики/логи показывают backoff; UI сообщает пользователю.
- **Owner:** frontend  
- **Effort:** S  

### [P1-RUN-03] `stabilization_window` после смены состояния

- **Слой:** frontend  
- **Описание:** Короткое окно подавления «дребезга» screen/reason при гонках webhook vs client refresh.  
- **Где:** клиентский resolver потребления bootstrap.  
- **Зависимости:** P1-RUN-02.  
- **Риск:** мигание экранов при Paddle delay.  
- **Приоритет:** P1  
- **DoD:** сценарий upgrade/pending из Phase 3.
- **Owner:** frontend  
- **Effort:** M  

### [P1-RUN-04] Прокидывание `request_id`

- **Слой:** backend + frontend  
- **Описание:** Сервер генерирует/принимает `request_id`; клиент подставляет в логи и заголовки повторов.  
- **Где:** bootstrap API, клиент.  
- **Зависимости:** P0-CON-01.  
- **Риск:** невозможность дебага прод-инцидентов.  
- **Приоритет:** P1  
- **DoD:** один запрос = один trace в логах backend.
- **Owner:** fullstack  
- **Effort:** M  

### [P1-RUN-05] Логирование переходов UI + dedup ~4s

- **Слой:** frontend  
- **Описание:** `logBillingUiTransition` с полями контракта; дедуп одинаковых переходов.  
- **Где:** `app/lib/logBillingUiTransition.ts`.  
- **Зависимости:** P1-RUN-04.  
- **Риск:** шум или пропуск важного перехода.  
- **Приоритет:** P1  
- **DoD:** нет дублей при double-render React в dev; есть событие при смене reason.
- **Owner:** frontend  
- **Effort:** S  

### [P1-RES-01] Invite flow в resolver (INVITE_PENDING / timeout)

- **Слой:** backend  
- **Описание:** Явные reason и экраны; согласование с action matrix (все действия ✗ до разрешения).  
- **Где:** billing shell resolver.  
- **Зависимости:** P0-LOG-01.  
- **Риск:** доступ до принятия инвайта.  
- **Приоритет:** P1  
- **DoD:** CJM сценарии 3–4 из Phase 3.
- **Owner:** backend  
- **Effort:** M  

### [P1-RES-02] `NO_ACCESS_TO_ORG` — отдельный UX и действия

- **Слой:** backend + frontend  
- **Описание:** Не смешивать с «нет проекта»; CTA: retry bootstrap, support, sign out — как в матрице.  
- **Где:** resolver + экран.  
- **Зависимости:** P0-LOG-01.  
- **Приоритет:** P1  
- **DoD:** отдельный screen id; нет отображения пустого дашборда как единственного сигнала.
- **Owner:** fullstack  
- **Effort:** M  

### [P1-RTE-01] Защита от redirect loop (`max_redirect_depth`)

- **Слой:** frontend  
- **Описание:** Ограничение глубины редиректов при onboarding/paywall.  
- **Где:** bootstrap client / navigation guard.  
- **Зависимости:** P0-CON-03.  
- **Риск:** бесконечные редиректы при баге маршрутизации.  
- **Приоритет:** P1  
- **DoD:** при превышении — безопасный экран + лог.
- **Owner:** frontend  
- **Effort:** S  

### [P1-RTE-02] `intended_route`: валидация и allowlist

- **Слой:** frontend + backend  
- **Описание:** Принимать только относительные пути приложения; запрет open redirect.  
- **Где:** обработчик post-login / billing redirect.  
- **Зависимости:** P1-RTE-01.  
- **Риск:** фишинг / утечка токена в query.  
- **Приоритет:** P1  
- **DoD:** негативные тесты на `//evil.com`, `javascript:`.
- **Owner:** fullstack  
- **Effort:** M  

### [P1-SAFE-01] `client_safe_mode`: вход и выход

- **Слой:** frontend  
- **Описание:** После исчерпания retry — ограниченный UI; выход после N успешных bootstrap подряд (политика §14).  
- **Где:** bootstrap client.  
- **Зависимости:** P1-RUN-02.  
- **Приоритет:** P1  
- **DoD:** пользователь видит причину и путь «повторить».
- **Owner:** frontend  
- **Effort:** M  

---

## Phase 2 — UX & product completeness

Фокус: доведение UI до соответствия плану.

### [P2-UI-01] Все shell-экраны только из `resolved_ui_state.screen`

- **Слой:** frontend  
- **Описание:** Единая фабрика экранов/модалок по `ScreenId`.  
- **Где:** layout, billing banners/modals.  
- **Зависимости:** P0-CON-03, P1-RES-01, P1-RES-02.  
- **Приоритет:** P1/P2 граница — P2 если объём большой.  
- **DoD:** code search не находит `switch(access_state)` в shell.
- **Owner:** frontend  
- **Effort:** L  

### [P2-UI-02] Действия только через `allowed_actions`

- **Слой:** frontend  
- **Описание:** Кнопки sync/export/billing выключены не «по локальной логике», а по списку действий с сервера.  
- **Где:** Topbar, страницы интеграций, отчёты.  
- **Зависимости:** P0-CON-01.  
- **Приоритет:** P2  
- **DoD:** рассинхрон с API матрицей ловится E2E или unit на mapper.
- **Owner:** frontend  
- **Effort:** M  

### [P2-UI-03] Data states: EMPTY / LIMITED / BLOCKED

- **Слой:** frontend  
- **Описание:** Единый паттерн копирайта и UI для виджетов (см. [`docs/billing/DATA_STATE_WIDGET_PATTERNS.md`](billing/DATA_STATE_WIDGET_PATTERNS.md)).  
- **Где:** dashboard widgets, LTV, attribution.  
- **Зависимости:** P0-UX-01.  
- **Приоритет:** P2  
- **DoD:** нет отображения «0» как нормы при BLOCKED; LIMITED с CTA upgrade.
- **Owner:** frontend  
- **Effort:** L  

### [P2-UI-04] Экран `OVER_LIMIT_*`

- **Слой:** frontend + backend  
- **Описание:** Fullscreen block по матрице; список сущностей, требующих снижения нагрузки (проекты, аккаунты, пользователи — по продукту).  
- **Где:** отдельный screen + API детализации лимита.  
- **Зависимости:** P0-CON-01.  
- **Приоритет:** P2  
- **DoD:** CJM сценарий 10.
- **Owner:** fullstack  
- **Effort:** L  

### [P2-UI-05] Post-checkout onboarding persistence

- **Слой:** backend + frontend  
- **Описание:** Шаги 1–3 и идемпотентное завершение; блокировка навигации до завершения (политика продукта).  
- **Где:** API post-checkout, модалка.  
- **Зависимости:** P0-CON-01.  
- **Приоритет:** P2  
- **DoD:** повтор логина не ломает прогресс; refresh страницы восстанавливает шаг.
- **Owner:** fullstack  
- **Effort:** L  

### [P2-UI-06] Banner vs modal vs fullscreen (политика приоритета)

- **Слой:** product + frontend  
- **Описание:** Таблица: какой `blocking_level` какой UI-контейнер открывает; без двух конкурирующих модалок.  
- **Где:** shell resolver consumer.  
- **Зависимости:** P2-UI-01.  
- **Приоритет:** P2  
- **DoD:** матрица в трекере + 3 скриншота состояний для дизайн-ревью.
- **Owner:** fullstack  
- **Effort:** M  

### [P2-UI-07] No silent downgrade

- **Слой:** frontend  
- **Описание:** Любое ухудшение плана/доступа сопровождается явным баннером/экраном и причиной (reason), не только «данные пропали».  
- **Где:** переходы состояния в provider.  
- **Зависимости:** P1-RUN-05.  
- **Приоритет:** P2  
- **DoD:** сценарий downgrade/past_due в Phase 3.
- **Owner:** frontend  
- **Effort:** S  

### [P2-UI-08] `pending_plan_change` UI (billing доминирует)

- **Слой:** backend + frontend  
- **Описание:** Сообщение ожидания webhook; блок критичных действий по матрице; согласовано с §13.1 основного плана.  
- **Где:** resolver + баннер.  
- **Зависимости:** P0-LOG-01.  
- **Приоритет:** P2  
- **DoD:** при одновременном billing problem показывается billing, не pending.
- **Owner:** fullstack  
- **Effort:** M  

---

## Phase 3 — QA & validation

Фокус: проверка системы.

### CJM сценарии (минимум 12)

1. Новый пользователь: регистрация → paywall → успешный checkout → post-checkout шаги → первый проект.  
2. Post-checkout: прерывание на шаге 2 → повторный вход → возврат к шагу.  
3. Invite: отправлен → экран ожидания → принятие → первый вход в проект.  
4. Invite: таймаут >7s → `INVITE_TIMEOUT` / retry / support.  
5. Unpaid: активная подписка истекла → read-only + CTA оплаты.  
6. Grace / past_due: баннер → оплата → восстановление heavy sync.  
7. Upgrade: оплата → `pending_plan_change` → webhook applied → UI без мигания лимитов.  
8. Downgrade (в конце периода): предупреждение → на дату смены лимиты в UI.  
9. Over-limit: превышение лимита сущностей → fullscreen block → после исправления разблокировка.  
10. Refund / hard block: полная блокировка с явным сообщением.  
11. Multi-tab: unpaid в одной вкладке → вторая вкладка синхронизируется без ручного refresh.  
12. Fallback: 503 bootstrap → safe mode → восстановление после retry.  
13. `NO_ACCESS_TO_ORG`: пользователь удалён из org — отдельный экран, не пустой дашборд.  
14. `client_safe_mode`: исчерпание retry → ограниченный UI → выход после стабильных успехов.  
15. Версия контракта: сервер отдаёт `version: v2_test` → клиент уходит в fallback без краша.

### Технические проверки (pass/fail)

- [ ] Нет production write endpoint без auth на критичных ресурсах (первая линия: P0-SEC-02 список).  
- [ ] Нет heavy sync без billing gate (выборка из инвентаризации).  
- [ ] UI shell не читает `access_state` / `onboarding_state` для выбора экрана (grep / ревью).  
- [ ] Все интерактивы, влияющие на деньги/данные, либо отключены, либо проходят проверку `allowed_actions` + серверный gate.  
- [ ] Fallback не позволяет успешный heavy POST (негативный тест).  
- [ ] `intended_route` не допускает внешние URL.  
- [ ] Логи переходов содержат `request_id` и dedup работает.  
- [ ] Чеклист [`docs/billing/BILLING_UX_VALIDATION_CHECKLIST.md`](billing/BILLING_UX_VALIDATION_CHECKLIST.md) пройден для релиза.

**Owner / Effort (Phase 3, совокупно для CJM + техпроверок):** **Owner:** qa (при необходимости **product** на копирайт/ожидания) | **Effort:** **L**

---

## Сводка: приоритеты P0 / P1 / P2

- **P0:** P0-SEC-* , P0-CON-* , P0-LOG-01, P0-UX-01, P0-RUN-01.  
- **P1:** Phase 1 целиком (runtime + resolver + route safety).  
- **P2:** Phase 2 (полнота UX и продуктовых экранов).

---

## Параллельность и очередь внедрения

**Сразу после старта (параллельно):** P0-SEC-01 + P0-SEC-02.  
**После инвентаризации:** P0-SEC-03 + P0-SEC-04 (можно параллельно по разным платформам OAuth).  
**После P0-CON-01:** параллельно P0-CON-02, P0-LOG-01, P0-UX-01; затем P0-CON-03 и P0-RUN-01.  
**Phase 1:** P1-RUN-04 рано; P1-RUN-01–03 связаны цепочкой; P1-RES-* после стабильного контракта.  
**Phase 2:** стартует когда P0-CON-03 и P0-CON-01 стабильны на staging.

---

## Definition of Done для всего Execution Plan

1. Все задачи P0 закрыты; исключения задокументированы и приняты risk-owner.  
2. Phase 3 пройдена: CJM 1–15 и технический чеклист без открытых fail.  
3. Нет известных Critical/Major из аудита в области биллинга/доступа без плана или waiver.  
4. Команда может отслеживать прогресс по ID задач в трекере 1:1 с этим документом.

---

## Rollout Strategy

Пошаговое включение в продакшен; между шагами — окно наблюдения и сравнение метрик с baseline (см. [Monitoring Plan](#monitoring-plan)).

**Step 1 — только логирование:** включить сбор **UI transitions** (`logBillingUiTransition` и аналоги) и прокидывание **`request_id`** в логах клиента/сервера; UI и гейты остаются как сейчас.  
**Мониторинг перед Step 2:** объём логов приемлемый; нет роста 5xx на bootstrap из‑за логирования; `request_id` виден в трассах.

**Step 2 — API отдаёт `resolved_ui_state`, UI игнорирует:** backend возвращает контракт в ответе bootstrap/current-plan; фронт **не** переключает shell по нему (только логирует/сравнивает в shadow, опционально).  
**Мониторинг перед Step 3:** нет регрессий latency; поле всегда присутствует при успехе; несоответствия reason vs legacy UI зафиксированы как баги, не как silent fix.

**Step 3 — один ключевой экран (dashboard) на `resolved_ui_state`:** только главный дашборд / shell-обвязка вокруг него читает `screen`/`reason`; остальное — legacy.  
**Мониторинг перед Step 4:** CJM для нового пользователя и post-checkout на dashboard без критичных багов; нет расширения действий относительно API.

**Step 4 — read-only billing gating:** блокировка тяжёлой аналитики/отчётов по billing read gate там, где по матрице запрещено; **без** полного heavy sync пока.  
**Мониторинг перед Step 5:** ожидаемый рост 402/403 на закрытых маршрутах, без аномального churn; поддержка не перегружена.

**Step 5 — heavy sync gating:** все heavy sync/refresh/oauth pull под единым billing heavy gate.  
**Мониторинг перед Step 6:** нет успешных sync при `BILLING_BLOCKED`; инвентаризация P0-SEC совпадает с прод-поведением.

**Step 6 — over-limit:** включить экран/режим `OVER_LIMIT_*` и API детализации.  
**Мониторинг перед Step 7:** пользователи выходят из блока предсказуемым путём; нет ложных блокировок (алерт по доле `OVER_LIMIT`).

**Step 7 — полный перевод UI на `resolved_ui_state`:** все shell-маршруты и глобальные баннеры/модалки только из контракта; `allowed_actions` для кнопок.  
**Мониторинг перед Step 8:** Phase 3 CJM и техпроверки зелёные; нет raw-branching в grep/ревью.

**Step 8 — отключить старую логику:** снять feature flags legacy shell; удалить или зафиксировать мёртвый код только после стабильного периода на Step 7.

**Параллельно допустимо:**

- Step 1 (логи + `request_id`) **параллельно** с закрытием критичных P0-SEC обходов (auth на write), если логирование не меняет контракт ответа.
- После Step 2: подготовка **read-only** gate на backend **параллельно** shadow-сравнению `resolved_ui_state` vs текущий UI.
- Документация и QA-скрипты для Phase 3 **параллельно** Step 3–5.

**Строго последовательно:** Step 5 не раньше Step 4, если read-only уже выявил расхождения; Step 8 не раньше зелёного Step 7 + окна наблюдения; полное отключение legacy — только после проверки [Rollback Strategy](#rollback-strategy).

---

## Rollback Strategy

**Feature flag (пример имени):** `billing_bootstrap_v2` (или набор флагов: `billing_resolved_ui_shell`, `billing_heavy_gate`, `billing_over_limit_ui`, `billing_fallback_strict` — единый переключатель «новая модель» vs legacy предпочтительнее для быстрого отката).

**Быстрый rollback (без деплоя):** выключить флаг(и) в конфиге провайдера фич (Vercel/Edge Config, LaunchDarkly, env + runtime read с TTL) так, чтобы клиент и/или сервер вернулись к пути **legacy shell / прежние ответы**. Требование: флаг читается на **каждом** bootstrap и при рендере shell, без агрессивного кэша без инвалидации.

**Что можно отключать по слоям (частичный rollback):**

| Компонент | Эффект отключения |
| --------- | ----------------- |
| Использование `resolved_ui_state` на фронте | Возврат к прежнему выбору экранов (временно допускается только как аварийная мера; нарушает [Global Invariants](#global-invariants) — фиксировать инцидент) |
| UI gating по `allowed_actions` | Кнопки снова по локальной логике; **серверные гейты обязаны остаться** |
| Over-limit экран | Скрыть fullscreen; лимиты всё равно enforce на API |
| `pending_plan_change` UI | Скрыть баннер; backend состояние не откатывать |
| Строгий `fallback_ui_state` / `client_safe_mode` | Ослабить до «показать последний успех» только если подтверждено отсутствие расширения прав; предпочтительнее полный флаг rollback |

**Частичный rollback:** отключить только подфлаг (например over-limit UI), оставив heavy gate включённым — для изоляции регрессии UX без открытия обхода оплаты.

**После rollback:** постмортем; повторный rollout с Step с более низкого номера при необходимости.

---

## Global Invariants

Правила, которые **нельзя** нарушать в продакшене без явного решения risk-owner и обновления спецификации:

1. При **успешном** bootstrap (HTTP 2xx и валидный контракт) **`resolved_ui_state` всегда присутствует** в ответе агрегата, от которого строится shell.  
2. **UI не использует** `access_state` / `onboarding_state` / membership **напрямую** для выбора shell-экрана (только через `resolved_ui_state` или безопасный fallback по политике §13.2 / §14).  
3. **Billing-логика имеет приоритет** над проверкой project access там, где определено порядком resolver (billing → project).  
4. **`fallback_ui_state` никогда не расширяет** доступ относительно последнего подтверждённого сервером состояния или safe read-only default.  
5. **Heavy sync** (и эквивалентные по нагрузке операции) **всегда** защищены billing heavy gate, кроме явно помеченного internal/cron bypass.  
6. **`allowed_actions`** (сервер) — **единственный источник правды** для разрешённых действий в UI; локальное включение кнопки без попадания в список недопустимо.  
7. **`version` контракта** проверяется клиентом; при mismatch — предсказуемый путь (fallback / safe mode), без интерполяции неизвестных `reason`.  
8. **`request_id` прокидывается** через цепочку: bootstrap → повторы → логи переходов UI → корреляция с серверными логами.

---

## Release Checklist (GO / NO-GO)

Перед выкладкой в прод:

- [ ] Все **P0** задачи закрыты или имеют письменный waiver с владельцем риска.  
- [ ] Критичные **P1** задачи (runtime: retry, `request_id`, multi-tab, `intended_route`, `client_safe_mode`) закрыты или перенесены с явным NO-GO условием.  
- [ ] **CJM** сценарии Phase 3 (1–15) пройдены на staging.  
- [ ] Нет **open critical** багов в биллинге / доступе / shell.  
- [ ] **`fallback_ui_state`** протестирован (ошибка сети, 503, частичный JSON).  
- [ ] **Multi-tab sync** протестирован.  
- [ ] **Version mismatch** обработан без краша и без расширения прав.  
- [ ] **Feature flags** заданы для prod; задокументированы значения по умолчанию и владелец изменений.  
- [ ] **Rollback strategy** проверена на staging (симуляция выключения флага до стабильного состояния в течение 5 минут).  
- [ ] **Monitoring** дашборды/алерты для метрик из [Monitoring Plan](#monitoring-plan) активны.

**NO-GO** при любом невыполненном пункте без зафиксированного исключения.

---

## Monitoring Plan

**Метрики (имена — зафиксировать в системе аналитики/логов):**

| Метрика | Назначение |
| ------- | ---------- |
| Доля сессий / пользователей в **`client_safe_mode`** | Рост указывает на деградацию bootstrap или сеть |
| Доля или счётчик входов в **`fallback_ui_state`** | Аномалия при росте без инцидента CDN/API |
| **Ошибки bootstrap** (4xx/5xx, таймауты, parse error) | Прямой сигнал недоступности контракта |
| **Spikes UI transitions** (события/сек или уникальные пользователи с превышением N переходов/мин) | Дребезг state, петли редиректа, баг в resolver |
| **Частота `pending_plan_change`** (по `reason` / screen) | Задержки webhook, зависшие апгрейды |
| **Несоответствие expected state** (сервер: `resolved_ui_state.reason` vs фактический результат gate на том же `request_id`) | Контракт vs enforcement |

**Что считать аномалией (пороги задать от baseline):**

- Резкий **рост** `client_safe_mode` или `fallback_ui_state` относительно 7-дневной медианы (например выше 3σ или удвоение).  
- Bootstrap error rate выше согласованного SLO (например выше 1% за 15 минут).  
- Всплеск **одного и того же** перехода UI (dedup не срабатывает или петля).  
- Доля `pending_plan_change` **не снижается** в течение ожидаемого окна webhook.

**Когда реагировать:**

- **P0:** рост bootstrap 5xx, признаки расширения доступа (сообщения пользователей + успешный heavy при unpaid) — немедленно, рассмотреть **быстрый rollback**.  
- **P1:** рост safe mode / fallback без 5xx — разбор в течение рабочего дня; частичный rollback UI.  
- **P2:** дрейф метрик — задача в бэклог с дедлайном.

**Обязательные события в логах / телеметрии:**

- Смена `resolved_ui_state` (from → to), `request_id`, `version`, источник (bootstrap, tab_sync, retry).  
- Вход и выход из **`client_safe_mode`** и **`fallback_ui_state`** с причиной.  
- Неуспешный bootstrap с кодом HTTP и `request_id`.  
- Срабатывание **billing gate** (код `BILLING_BLOCKED`) с типом маршрута (read / heavy).  
- Срабатывание **rollback** feature flag (кто, когда, старое/новое значение).

---

*Документ: Billing System Execution Plan. Существующие архитектурные планы и чеклисты не изменялись; при расхождении приоритет у зафиксированной продуктовой спецификации после явного решения.*
