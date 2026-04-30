# BoardIQ: Карта разделов и подразделов базы знаний (RU)

## Назначение

Этот документ преобразует матрицу вопросов в информационную архитектуру базы знаний:
- `L1` — раздел
- `L2` — подраздел
- `L3` — будущая статья (slug)

---

## Структура KB

## 1. Начало работы
- **L2: До регистрации**
  - `what-boardiq-solves-first-week`
  - `supported-channels-and-data-sources`
  - `free-vs-paid-what-changes`
- **L2: Регистрация и вход**
  - `create-account-on-login-page`
  - `email-already-registered-what-to-do`
  - `password-reset-end-to-end`
  - `signup-notification-vs-confirmation-email`
- **L2: Первый вход**
  - `first-10-minutes-after-signup`
  - `why-redirected-to-onboarding`
  - `account-activation-checklist`

## 2. Онбординг и настройка workspace
- **L2: Прохождение онбординга**
  - `complete-onboarding-steps-1-2-3`
  - `required-company-fields-and-validation`
  - `save-company-step-troubleshooting`
- **L2: Структура рабочего пространства**
  - `organization-vs-project-structure`
  - `setup-for-single-brand-vs-multi-brand`
  - `onboarding-state-and-resume-behavior`

## 3. Подключение источников
- **L2: Meta**
  - `connect-meta-ads-account`
  - `meta-oauth-errors-and-fixes`
  - `meta-connection-validation-checklist`
- **L2: Google**
  - `connect-google-ads-account`
  - `google-oauth-errors-and-fixes`
  - `google-connection-validation-checklist`
- **L2: TikTok**
  - `connect-tiktok-ads-account`
  - `tiktok-oauth-errors-and-fixes`
  - `tiktok-connection-validation-checklist`
- **L2: Синхронизация**
  - `why-sync-disabled-billing-or-permissions`
  - `freshness-windows-by-source`
  - `token-lifecycle-and-reconnect-guidance`

## 4. Трекинг и события
- **L2: Pixel**
  - `install-pixel-and-verify`
  - `pixel-not-firing-troubleshooting`
  - `pixel-browser-checklist`
- **L2: UTM**
  - `utm-naming-conventions`
  - `utm-common-mistakes-and-prevention`
- **L2: Conversion events**
  - `configure-registration-and-purchase-events`
  - `meta-capi-and-pixel-dedup-explained`
  - `missing-fbp-fbc-impact-and-recovery`
  - `event-idempotency-and-duplicates`

## 5. Качество данных и диагностика
- **L2: Проверка корректности**
  - `day0-data-validation-checklist`
  - `why-dashboard-shows-zero-data`
  - `platform-vs-boardiq-metric-differences`
- **L2: Согласованность данных**
  - `timezone-and-currency-mismatch-fixes`
  - `expected-latency-by-report`
  - `historical-backfill-expectations`
- **L2: Центр устранения проблем**
  - `top-registration-onboarding-errors`
  - `top-connection-and-sync-errors`
  - `what-to-collect-before-contacting-support`

## 6. Дашборды и отчеты
- **L2: Базовая работа с dashboard**
  - `read-main-kpis-correctly`
  - `which-kpi-to-use-for-weekly-decisions`
  - `dashboard-filters-time-source-campaign`
- **L2: Weekly report**
  - `weekly-board-report-overview`
  - `share-and-revoke-report-links`
  - `kpi-changes-after-sync-explained`
- **L2: Справочник метрик**
  - `metric-definitions-and-formulas`
  - `known-metric-caveats`

## 7. Атрибуция и принятие решений
- **L2: Основы атрибуции**
  - `how-to-read-attribution-output`
  - `attribution-vs-platform-differences`
  - `model-selection-for-budget-decisions`
- **L2: Практическая оптимизация**
  - `turn-attribution-into-action-plan`
  - `weekly-optimization-loop`
  - `advanced-blended-channel-interpretation`

## 8. Команда, роли, доступы
- **L2: Роли и права**
  - `roles-permissions-matrix`
  - `invite-user-and-assign-role`
  - `accepted-invite-but-no-access`
- **L2: Администрирование**
  - `transfer-ownership-safe-procedure`
  - `remove-member-without-breaking-access`
  - `agency-client-access-separation`

## 9. Биллинг и управление тарифом
- **L2: Операции с тарифом**
  - `upgrade-downgrade-how-it-works`
  - `plan-limits-projects-seats-sync`
  - `free-to-paid-transition-checklist`
- **L2: Инциденты биллинга**
  - `payment-success-but-access-blocked`
  - `billing-reconcile-how-to`
  - `refund-cancel-impact-on-access`
- **L2: Справка по состояниям**
  - `billing-status-state-machine`
  - `grace-periods-and-expiry-behavior`

## 10. Экспорт и внешние интеграции
- **L2: Экспорт**
  - `export-csv-xls-guide`
  - `export-vs-dashboard-mismatch`
  - `export-field-dictionary`
- **L2: Внешние процессы**
  - `connect-output-to-crm-or-bi`
  - `report-sharing-governance`

## 11. Безопасность, приватность, юридические аспекты
- **L2: Данные и безопасность**
  - `how-data-is-stored-and-processed`
  - `security-best-practices-for-teams`
  - `data-deletion-request-flow`
- **L2: Документы**
  - `terms-practical-summary`
  - `privacy-policy-practical-summary`
  - `dpa-when-needed-and-how-to-request`

## 12. Поддержка и эскалация
- **L2: Поддержка**
  - `how-to-open-effective-support-request`
  - `required-context-screens-ids-timestamps`
  - `sla-by-issue-type`
- **L2: Эскалация**
  - `critical-incident-escalation-path`
  - `agency-escalation-on-behalf-of-client`

---

## Волны публикации

## Wave 1 (P0, блокеры)
- Регистрация и вход
- Онбординг
- Подключение источников + OAuth recovery
- Pixel/события/дедупликация
- Качество данных (нули, рассинхрон)
- Биллинг-инциденты (оплата есть, доступа нет)
- Базовый гайд обращения в поддержку

## Wave 2 (P1, операционная стабильность)
- Дашборды и weekly report
- Атрибуция и интерпретация
- Роли/команда/доступы
- Лимиты тарифов и рабочие процессы
- Экспорт и внешние процессы

## Wave 3 (P2, advanced)
- Продвинутые атрибуционные сценарии
- Масштабирование агентского процесса
- Углубленная справка по биллингу/состояниям
- Расширенные playbook по инцидентам

---

## Единый шаблон статьи

1. Заголовок
2. Для кого статья
3. Когда использовать
4. Быстрый ответ (TL;DR)
5. Пошаговые действия
6. Как проверить результат
7. Частые ошибки и решения
8. Ограничения/краевые случаи
9. Связанные статьи
10. Как эскалировать, если не помогло
# BoardIQ Knowledge Base: IA Sections Map

## Purpose

This file translates the questions matrix into a publishable information architecture:
- `L1`: major section
- `L2`: subsection
- `L3`: article topic (proposed slug)

Primary audience: mixed (owner, marketer, analyst, agency, admin).

---

## IA Map (Sections and Subsections)

## 1. Getting Started

- **L2: Product fit and prerequisites**
  - `what-boardiq-solves-first-week`
  - `supported-channels-and-data-sources`
  - `free-vs-paid-what-changes`
- **L2: Registration and login**
  - `create-account-on-login-page`
  - `email-already-registered-what-to-do`
  - `password-reset-end-to-end`
  - `signup-notification-vs-confirmation-email`
- **L2: First successful session**
  - `first-10-minutes-after-signup`
  - `why-redirected-to-onboarding`
  - `account-activation-checklist`

## 2. Onboarding and Workspace Setup

- **L2: Onboarding steps**
  - `complete-onboarding-steps-1-2-3`
  - `required-company-fields-and-validation`
  - `save-company-step-troubleshooting`
- **L2: Workspace model**
  - `organization-vs-project-structure`
  - `setup-for-single-brand-vs-multi-brand`
  - `onboarding-state-and-resume-behavior`

## 3. Data Connections

- **L2: Meta integration**
  - `connect-meta-ads-account`
  - `meta-oauth-errors-and-fixes`
  - `meta-connection-validation-checklist`
- **L2: Google integration**
  - `connect-google-ads-account`
  - `google-oauth-errors-and-fixes`
  - `google-connection-validation-checklist`
- **L2: TikTok integration**
  - `connect-tiktok-ads-account`
  - `tiktok-oauth-errors-and-fixes`
  - `tiktok-connection-validation-checklist`
- **L2: Sync behavior**
  - `why-sync-disabled-billing-or-permissions`
  - `freshness-windows-by-source`
  - `token-lifecycle-and-reconnect-guidance`

## 4. Tracking and Event Collection

- **L2: Pixel setup**
  - `install-pixel-and-verify`
  - `pixel-not-firing-troubleshooting`
  - `pixel-browser-checklist`
- **L2: UTM setup**
  - `utm-naming-conventions`
  - `utm-common-mistakes-and-prevention`
- **L2: Conversion events**
  - `configure-registration-and-purchase-events`
  - `meta-capi-and-pixel-dedup-explained`
  - `missing-fbp-fbc-impact-and-recovery`
  - `event-idempotency-and-duplicates`

## 5. Data Quality and Diagnostics

- **L2: Validation**
  - `day0-data-validation-checklist`
  - `why-dashboard-shows-zero-data`
  - `platform-vs-boardiq-metric-differences`
- **L2: Data consistency**
  - `timezone-and-currency-mismatch-fixes`
  - `expected-latency-by-report`
  - `historical-backfill-expectations`
- **L2: Troubleshooting hub**
  - `top-registration-onboarding-errors`
  - `top-connection-and-sync-errors`
  - `what-to-collect-before-contacting-support`

## 6. Dashboards and Reporting

- **L2: Core dashboard usage**
  - `read-main-kpis-correctly`
  - `which-kpi-to-use-for-weekly-decisions`
  - `dashboard-filters-time-source-campaign`
- **L2: Weekly reporting**
  - `weekly-board-report-overview`
  - `share-and-revoke-report-links`
  - `kpi-changes-after-sync-explained`
- **L2: Metric dictionary**
  - `metric-definitions-and-formulas`
  - `known-metric-caveats`

## 7. Attribution and Decision-Making

- **L2: Attribution basics**
  - `how-to-read-attribution-output`
  - `attribution-vs-platform-differences`
  - `model-selection-for-budget-decisions`
- **L2: Practical optimization**
  - `turn-attribution-into-action-plan`
  - `weekly-optimization-loop`
  - `advanced-blended-channel-interpretation`

## 8. Team, Roles, and Access

- **L2: Roles and permissions**
  - `roles-permissions-matrix`
  - `invite-user-and-assign-role`
  - `accepted-invite-but-no-access`
- **L2: Organization administration**
  - `transfer-ownership-safe-procedure`
  - `remove-member-without-breaking-access`
  - `agency-client-access-separation`

## 9. Billing and Plan Management

- **L2: Plan operations**
  - `upgrade-downgrade-how-it-works`
  - `plan-limits-projects-seats-sync`
  - `free-to-paid-transition-checklist`
- **L2: Billing incidents**
  - `payment-success-but-access-blocked`
  - `billing-reconcile-how-to`
  - `refund-cancel-impact-on-access`
- **L2: Billing state reference**
  - `billing-status-state-machine`
  - `grace-periods-and-expiry-behavior`

## 10. Export and Integrations

- **L2: Data export**
  - `export-csv-xls-guide`
  - `export-vs-dashboard-mismatch`
  - `export-field-dictionary`
- **L2: External workflows**
  - `connect-output-to-crm-or-bi`
  - `report-sharing-governance`

## 11. Security, Privacy, and Legal

- **L2: Data and security**
  - `how-data-is-stored-and-processed`
  - `security-best-practices-for-teams`
  - `data-deletion-request-flow`
- **L2: Legal documents**
  - `terms-practical-summary`
  - `privacy-policy-practical-summary`
  - `dpa-when-needed-and-how-to-request`

## 12. Support and Escalation

- **L2: Contacting support**
  - `how-to-open-effective-support-request`
  - `required-context-screens-ids-timestamps`
  - `sla-by-issue-type`
- **L2: Escalation**
  - `critical-incident-escalation-path`
  - `agency-escalation-on-behalf-of-client`

---

## Publication Waves

## Wave 1 (P0, blocker removal)

- Getting Started / Registration and login
- Onboarding and Workspace Setup
- Data Connections (all three channels + OAuth diagnostics)
- Tracking and Event Collection (pixel + conversion events + dedup)
- Data Quality and Diagnostics (zero data, mismatch, latency)
- Billing incidents (payment success but blocked, reconcile)
- Support article for fast triage payload

## Wave 2 (P1, operational maturity)

- Dashboards and Reporting
- Attribution and Decision-Making
- Team, Roles, and Access
- Plan operations and limits
- Export and integrations basics
- Security best practices and practical policy summaries

## Wave 3 (P2, scale and advanced ops)

- Advanced attribution interpretation
- Agency operating model and governance
- Billing state reference internals
- Advanced external workflow patterns
- Incident taxonomy and escalation playbooks

---

## Standard Article Template

Use this structure for each KB article:

1. **Title**
2. **Who this is for** (role + stage)
3. **When to use this guide**
4. **Quick answer (TL;DR)**
5. **Step-by-step instructions**
6. **How to verify success**
7. **Common issues and fixes**
8. **Limits / edge cases**
9. **Related articles**
10. **Escalation path** (if unresolved)

---

## Done Criteria for IA

- Every `P0` matrix item has a mapped article slug.
- No onboarding/connection/tracking blocker is left unmapped.
- Wave 1 can be published independently and supports first-time activation end-to-end.
