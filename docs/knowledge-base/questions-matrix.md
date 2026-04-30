# BoardIQ: Матрица вопросов пользователей

## Цель

Этот документ фиксирует вопросы пользователей на всем пути использования сервиса:
от первого знакомства до масштабирования и поддержки.

Аудитория смешанная:
- собственник/руководитель
- маркетолог
- аналитик
- агентство/подрядчик
- администратор workspace

Приоритеты:
- `P0` — блокирует запуск или корректную работу
- `P1` — важные операционные вопросы
- `P2` — продвинутый уровень и оптимизация

Типы ответов:
- `Quick` — короткий ответ (FAQ)
- `Guide` — пошаговая инструкция
- `Diagnostic` — диагностика и устранение проблемы
- `Checklist` — чеклист проверки
- `Reference` — справка/ограничения/термины

---

## Этапы пути пользователя

1. До регистрации (оценка пользы и соответствия)
2. Регистрация и вход
3. Первая активация аккаунта
4. Онбординг компании и workspace
5. Подключение источников (Meta/Google/TikTok)
6. Настройка трекинга (Pixel/UTM/события)
7. Проверка качества данных
8. Дашборды и отчеты
9. Атрибуция и интерпретация
10. Команда и доступы
11. Биллинг и подписка
12. Ошибки и восстановление
13. Экспорт и внешние интеграции
14. Безопасность, приватность, юридические вопросы
15. Масштабирование процессов
16. Поддержка и эскалация

---

## Вопросы по этапам (подробно)

## 1) До регистрации
- `P0 | Quick`: Что BoardIQ дает в первую неделю?
- `P0 | Quick`: Какие рекламные каналы поддерживаются?
- `P0 | Reference`: Для кого подходит: один проект или мультибренд?
- `P1 | Quick`: Free vs платные тарифы — что реально меняется?
- `P1 | Guide`: Как агентству правильно структурировать клиентов?
- `P2 | Reference`: Какие ограничения важно знать до старта?

## 2) Регистрация и вход
- `P0 | Guide`: Как зарегистрироваться через `/login`?
- `P0 | Diagnostic`: Что делать при «email уже зарегистрирован»?
- `P0 | Diagnostic`: Почему не пускает при правильном пароле?
- `P0 | Guide`: Как правильно пройти восстановление пароля?
- `P1 | Diagnostic`: Почему не пришло письмо и как переотправить?
- `P1 | Quick`: Чем отличается письмо-уведомление от подтверждения email?

## 3) Первая активация
- `P0 | Guide`: Что делать сразу после первого входа?
- `P0 | Checklist`: Чеклист «аккаунт активирован корректно»
- `P1 | Quick`: Почему редиректит в онбординг, а не в dashboard?
- `P1 | Diagnostic`: Почему показывается onboarding_not_active?

## 4) Онбординг компании
- `P0 | Guide`: Как пройти шаги 1–3 без ошибок?
- `P0 | Diagnostic`: Почему кнопка «Далее» не переводит дальше?
- `P0 | Checklist`: Какие поля обязательны на шаге компании?
- `P0 | Quick`: Какие события отправляются на шаге 2?
- `P1 | Guide`: Как изменить данные компании после онбординга?

## 5) Подключение источников
- `P0 | Guide`: Подключение Meta Ads end-to-end
- `P0 | Guide`: Подключение Google Ads end-to-end
- `P0 | Guide`: Подключение TikTok Ads end-to-end
- `P0 | Diagnostic`: Ошибки OAuth callback и точные шаги восстановления
- `P1 | Checklist`: Как проверить, что подключение рабочее
- `P1 | Diagnostic`: Почему синк недоступен (права/биллинг/состояние)

## 6) Трекинг и события
- `P0 | Guide`: Как установить Pixel и проверить срабатывание?
- `P0 | Guide`: Как настроить UTM-стандарты?
- `P0 | Guide`: Как настроить события регистраций и покупок?
- `P0 | Diagnostic`: Почему событие есть в браузере, но нет в отчетах?
- `P1 | Checklist`: Проверка CAPI + Pixel + дедупликация
- `P1 | Diagnostic`: Что делать при отсутствии `_fbp` / `_fbc`?

## 7) Качество данных
- `P0 | Checklist`: День-0 проверка качества данных
- `P0 | Diagnostic`: Почему нули в дашборде при подключенном источнике?
- `P0 | Diagnostic`: Почему цифры не совпадают с рекламным кабинетом?
- `P1 | Guide`: Как понимать freshness и лаги обновления?
- `P1 | Diagnostic`: Проблемы timezone/currency и способы исправления

## 8) Дашборды и отчеты
- `P0 | Guide`: Как читать основные KPI корректно?
- `P0 | Quick`: Какие KPI использовать для weekly-решений?
- `P0 | Guide`: Как строить срезы по источнику/кампаниям/периоду?
- `P1 | Guide`: Как работать с weekly report и sharing?
- `P1 | Reference`: Словарь метрик и формулы расчета

## 9) Атрибуция
- `P0 | Guide`: Как интерпретировать атрибуцию без ошибок
- `P0 | Quick`: Какой подход выбрать для бюджетных решений
- `P1 | Diagnostic`: Почему атрибуция отличается от платформ
- `P1 | Guide`: Как переводить атрибуцию в action plan

## 10) Команда и доступы
- `P0 | Guide`: Как пригласить участника и выдать правильную роль?
- `P0 | Diagnostic`: Инвайт принят, но доступа нет — что проверить?
- `P1 | Guide`: Как безопасно удалить участника/передать ownership?
- `P1 | Quick`: Матрица ролей и прав доступа

## 11) Биллинг
- `P0 | Guide`: Как апгрейд/даунгрейд влияет на доступ?
- `P0 | Diagnostic`: Оплата прошла, но доступ все еще заблокирован
- `P0 | Diagnostic`: Почему отключены синки/функции
- `P1 | Guide`: Грейс-периоды, reconcile, поведение статусов
- `P1 | Quick`: Лимиты тарифа: seats/projects/sync

## 12) Ошибки и восстановление
- `P0 | Diagnostic`: Топовые ошибки регистрации/онбординга/подключения
- `P0 | Checklist`: Что собрать перед обращением в поддержку
- `P1 | Checklist`: Браузерные проверки (cookies, extensions, incognito)
- `P1 | Diagnostic`: Частые API-ошибки и их причины

## 13) Экспорт и интеграции
- `P0 | Guide`: Экспорт CSV/XLS и проверка полей
- `P1 | Guide`: Шаринг отчетов стейкхолдерам
- `P1 | Guide`: Подключение к CRM/BI-процессам
- `P1 | Diagnostic`: Почему экспорт и экран расходятся

## 14) Безопасность и юридические вопросы
- `P0 | Quick`: Где и как хранятся данные
- `P0 | Quick`: Как запросить удаление данных
- `P1 | Guide`: Практики безопасного доступа для команд
- `P1 | Reference`: Terms/Privacy/DPA простым языком

## 15) Масштабирование
- `P1 | Guide`: Переход от одного проекта к мультипроектной модели
- `P1 | Guide`: Операционная схема для агентств
- `P1 | Guide`: Недельный/месячный цикл работы с отчетностью
- `P2 | Guide`: Продвинутый цикл оптимизации (атрибуция + качество данных)

## 16) Поддержка и эскалация
- `P0 | Guide`: Как написать эффективный тикет в поддержку
- `P0 | Checklist`: Обязательный контекст для быстрого решения
- `P1 | Quick`: SLA и ожидания по типам инцидентов
- `P1 | Guide`: Когда и как эскалировать критические блокеры

---

## Критерий полноты (DoD)

- На каждом этапе есть хотя бы один `P0`.
- Для этапов регистрации, онбординга, подключения и качества данных есть:
  - гайд
  - диагностика
  - чеклист проверки
- Все блокирующие сценарии доступа и биллинга имеют понятный recovery path.
- Каждая группа вопросов сопоставлена с будущими статьями в IA-карте.
# BoardIQ Knowledge Base: Questions Matrix

## Scope

This matrix maps end-to-end user questions by journey stage for a mixed audience:
- Owner / founder
- Marketer
- Analyst
- Agency / contractor
- Workspace admin

Priority legend:
- `P0` blocks activation or trusted usage
- `P1` important for steady usage and team adoption
- `P2` advanced optimization and edge workflows

Answer type legend:
- `Quick`: short answer / FAQ
- `Guide`: step-by-step how-to
- `Diagnostic`: troubleshooting flow
- `Checklist`: verification list
- `Reference`: limits, glossary, policy

---

## Journey Stages

1. Pre-signup and fit
2. Registration and login
3. Account activation and first session
4. Company onboarding and workspace setup
5. Data source connections (Meta / Google / TikTok)
6. Tracking setup (Pixel / UTM / conversion events)
7. Data quality and validation
8. Dashboards and reporting
9. Attribution and interpretation
10. Team and access management
11. Billing and subscription operations
12. Errors and recovery
13. Export and external integrations
14. Security, privacy, and legal
15. Scale and operating model
16. Support and escalation

---

## Detailed Question Matrix

### 1) Pre-signup and fit

- **P0 | Owner | Quick**: What business problems does BoardIQ solve first week?
- **P0 | Marketer | Quick**: Which channels are supported today (Meta/Google/TikTok)?
- **P0 | Analyst | Reference**: What metrics are first-party vs platform-derived?
- **P0 | Owner | Reference**: Is this suitable for single project vs multi-brand setup?
- **P1 | Agency | Guide**: How to structure clients as organizations/projects?
- **P1 | Owner | Quick**: What is included in Free vs paid plans?
- **P1 | Analyst | Reference**: What attribution methods are available and when to use each?
- **P2 | Admin | Reference**: What are known product limitations before onboarding?

### 2) Registration and login

- **P0 | Any | Guide**: How to create account from `/login`?
- **P0 | Any | Diagnostic**: Why do I see "email already registered" during signup?
- **P0 | Any | Diagnostic**: Correct password but login fails - what to do?
- **P0 | Any | Guide**: How password reset flow works and where reset link leads?
- **P1 | Any | Diagnostic**: Why confirmation email did not arrive (spam, resend, cooldown)?
- **P1 | Any | Quick**: Difference between signup confirmation and success notification email.
- **P1 | Any | Diagnostic**: Why invite links open but cannot finish auth?
- **P2 | Admin | Reference**: What auth events are logged and where.

### 3) Account activation and first session

- **P0 | Any | Guide**: What to do immediately after first successful login?
- **P0 | Any | Checklist**: Activation done checklist (session, org, onboarding access).
- **P1 | Marketer | Quick**: Why I am redirected to onboarding instead of dashboard?
- **P1 | Any | Diagnostic**: Why "onboarding not active" message appears?
- **P1 | Any | Quick**: How first screen differs for free, paid, invited users.
- **P2 | Analyst | Reference**: How bootstrap state and access state are determined.

### 4) Company onboarding and workspace setup

- **P0 | Any | Guide**: How to complete steps 1-3 onboarding correctly.
- **P0 | Any | Diagnostic**: Why "Next" on company step does not move forward.
- **P0 | Any | Checklist**: Required company fields and valid formats.
- **P0 | Any | Quick**: What event is sent at step 2 and when.
- **P1 | Owner | Guide**: How to update company info after onboarding.
- **P1 | Admin | Diagnostic**: Page refresh returns to previous step - expected behavior?
- **P2 | Analyst | Reference**: How onboarding status persists in backend model.

### 5) Data source connections

- **P0 | Marketer | Guide**: Connect Meta account end-to-end.
- **P0 | Marketer | Guide**: Connect Google Ads account end-to-end.
- **P0 | Marketer | Guide**: Connect TikTok account end-to-end.
- **P0 | Any | Diagnostic**: OAuth callback errors and exact recovery steps.
- **P1 | Agency | Guide**: How to connect correct ad accounts for each project.
- **P1 | Analyst | Checklist**: Connection validation checklist after OAuth.
- **P1 | Marketer | Diagnostic**: Why sync is disabled (billing/state/permissions).
- **P2 | Admin | Reference**: Token lifetime and refresh behavior.

### 6) Tracking setup (Pixel / UTM / events)

- **P0 | Marketer | Guide**: Install pixel correctly and verify first hits.
- **P0 | Marketer | Guide**: Setup UTM conventions for clean attribution.
- **P0 | Analyst | Guide**: Configure conversion events (registration/purchase).
- **P0 | Any | Diagnostic**: Event fired in browser but not visible in reports - why?
- **P1 | Marketer | Checklist**: Meta CAPI + Pixel dedup verification.
- **P1 | Analyst | Reference**: Required event fields, optional fields, hashing expectations.
- **P1 | Marketer | Diagnostic**: Missing `_fbp` / `_fbc` and impact on match quality.
- **P2 | Analyst | Reference**: Event idempotency behavior and duplicate prevention.

### 7) Data quality and validation

- **P0 | Analyst | Checklist**: Day-0 data validation flow after setup.
- **P0 | Analyst | Diagnostic**: Spend/click mismatch vs ad platform.
- **P0 | Any | Diagnostic**: Zero data in dashboard though source connected.
- **P1 | Analyst | Guide**: How freshness and sync cadence work.
- **P1 | Marketer | Diagnostic**: Timezone/currency mismatch symptoms and fixes.
- **P1 | Analyst | Reference**: Expected delays by source and report type.
- **P2 | Admin | Reference**: Backfill boundaries and historical completeness policy.

### 8) Dashboards and reporting

- **P0 | Marketer | Guide**: Read main dashboard cards correctly.
- **P0 | Owner | Quick**: Which KPI should I trust for weekly decisions.
- **P0 | Analyst | Guide**: Build report slices by source/campaign/time.
- **P1 | Marketer | Guide**: Weekly board report usage and sharing.
- **P1 | Owner | Diagnostic**: Why KPI changed after sync.
- **P1 | Analyst | Reference**: Definitions for each KPI and metric formula.
- **P2 | Agency | Guide**: How to present account-level insights to clients.

### 9) Attribution and interpretation

- **P0 | Analyst | Guide**: How to interpret attribution outputs without overclaiming.
- **P0 | Marketer | Quick**: Which model to use for tactical budget changes.
- **P1 | Analyst | Diagnostic**: Why attribution differs from platform-reported conversions.
- **P1 | Owner | Quick**: How to turn attribution into spend actions.
- **P1 | Analyst | Reference**: Attribution assumptions and caveats.
- **P2 | Analyst | Guide**: Advanced interpretation for blended channel strategies.

### 10) Team and access management

- **P0 | Admin | Guide**: Invite teammate and set correct role.
- **P0 | Admin | Diagnostic**: User accepted invite but cannot access project.
- **P1 | Admin | Guide**: Remove member or transfer ownership safely.
- **P1 | Agency | Guide**: Separate client access to avoid cross-project leakage.
- **P1 | Any | Quick**: Role permissions matrix (owner/admin/member/viewer).
- **P2 | Admin | Reference**: Seat logic and membership edge cases.

### 11) Billing and subscription operations

- **P0 | Owner | Guide**: Upgrade/downgrade plans and effective timing.
- **P0 | Owner | Diagnostic**: Payment completed but access still blocked.
- **P0 | Any | Diagnostic**: Why sync/features disabled by billing state.
- **P1 | Owner | Guide**: Understand grace periods and reconciliation behavior.
- **P1 | Admin | Quick**: Plan limits: projects, seats, heavy sync.
- **P1 | Owner | Diagnostic**: Refund/cancel impact on access.
- **P2 | Admin | Reference**: Billing status state machine and transitions.

### 12) Errors and recovery

- **P0 | Any | Diagnostic**: Top 10 registration/login/onboarding errors and one-click fixes.
- **P0 | Any | Diagnostic**: What to capture before contacting support.
- **P1 | Any | Checklist**: Browser-side checks (extensions, cookies, incognito).
- **P1 | Analyst | Diagnostic**: API route errors and common causes.
- **P2 | Admin | Reference**: Incident classification and priority hints.

### 13) Export and external integrations

- **P0 | Analyst | Guide**: Export reports (CSV/XLS) and verify fields.
- **P1 | Owner | Guide**: Share weekly report securely with stakeholders.
- **P1 | Analyst | Guide**: Connect output to CRM/BI workflows.
- **P1 | Agency | Diagnostic**: Export mismatch vs dashboard view.
- **P2 | Analyst | Reference**: Export schema and field dictionary.

### 14) Security, privacy, legal

- **P0 | Owner | Quick**: Where and how data is stored/processed.
- **P0 | Owner | Quick**: How to request deletion and what is deleted.
- **P1 | Admin | Guide**: Security hygiene for team access and credentials.
- **P1 | Owner | Reference**: Terms, privacy policy, DPA and practical implications.
- **P2 | Admin | Reference**: Internal controls and audit-related answers.

### 15) Scale and operating model

- **P1 | Owner | Guide**: Move from one project to multi-project operating model.
- **P1 | Agency | Guide**: Standard operating checklist for multiple clients.
- **P1 | Analyst | Guide**: Weekly/monthly reporting cadence best practices.
- **P2 | Owner | Quick**: Maturity model: what to improve next by team size.
- **P2 | Analyst | Guide**: Advanced optimization loop using attribution + quality checks.

### 16) Support and escalation

- **P0 | Any | Guide**: How to contact support with actionable context.
- **P0 | Any | Checklist**: Mandatory payload for fast resolution (screens, IDs, timestamps).
- **P1 | Owner | Quick**: SLA expectations by issue type.
- **P1 | Admin | Guide**: Internal escalation path for org-critical blockers.
- **P2 | Agency | Guide**: How to escalate on behalf of client while preserving privacy.

---

## Coverage Checklist (Definition of Done)

- Every journey stage has at least one `P0`.
- Registration, onboarding, source connection, and data validation each have:
  - setup guide
  - diagnostic flow
  - verification checklist
- Billing and access blockers have explicit recovery playbooks.
- Legal/privacy answers are available in user language (non-legalese version + policy links).
- Each matrix row maps to a future KB article slug in IA map.
