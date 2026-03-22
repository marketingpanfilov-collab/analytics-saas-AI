# Аудит миграций базы данных

**Дата аудита:** 2025-03-06  
**Цель:** Проверить соответствие структуры БД коду системы, выявить проблемы без внесения изменений.

---

## 1️⃣ Список всех миграций

Директория: `supabase/migrations/`. Порядок выполнения — по имени файла (timestamp).

| № | Файл | Дата (из имени) | Описание |
|---|------|-----------------|----------|
| 1 | `20250307000001_multi_tenant_organizations.sql` | 2025-03-07 | organizations, organization_members, projects.organization_id |
| 2 | `20250307000002_multi_tenant_integrations.sql` | 2025-03-07 | integrations, integrations_meta.integrations_id |
| 3 | `20250307000003_multi_tenant_ad_accounts.sql` | 2025-03-07 | ad_accounts (platform_account_id, platform) |
| 4 | `20250307000004_multi_tenant_campaigns.sql` | 2025-03-07 | campaigns.ad_accounts_id |
| 5 | `20250307000005_multi_tenant_daily_ad_metrics.sql` | 2025-03-07 | daily_ad_metrics |
| 6 | `20250307000006_daily_ad_metrics_add_missing_columns.sql` | 2025-03-07 | daily_ad_metrics: reach, cpm, cpc, ctr, leads, purchases, revenue, roas |
| 7 | `20250307000007_daily_ad_metrics_campaign_view.sql` | 2025-03-07 | VIEW daily_ad_metrics_campaign |
| 8 | `20250307000008_integrations_ensure_unique_project_platform.sql` | 2025-03-07 | UNIQUE (project_id, platform) на integrations |
| 9 | `20250307000009_ad_accounts_ensure_unique_integration_external.sql` | 2025-03-07 | UNIQUE (integration_id, **external_account_id**) на ad_accounts |
| 10 | `20250307100000_ad_accounts_unique_integration_external_id.sql` | 2025-03-07 | То же: idx на (integration_id, **external_account_id**) |
| 11 | `20250307200000_ad_account_settings.sql` | 2025-03-07 | ad_account_settings, backfill по **external_account_id** |
| 12 | `20250307300000_sync_runs.sql` | 2025-03-07 | sync_runs |
| 13 | `20250307400000_integrations_auth.sql` | 2025-03-07 | integrations_auth |
| 14 | `20250307500000_campaigns_external_campaign_id.sql` | 2025-03-07 | campaigns.external_campaign_id |
| 15 | `20250308000000_backfill_campaigns_platform.sql` | 2025-03-08 | Backfill campaigns.platform из ad_accounts (**provider**) |
| 16 | `20250309000000_visit_source_events.sql` | 2025-03-09 | visit_source_events (базовая таблица) |
| 17 | `20250310000000_project_invites.sql` | 2025-03-10 | project_invites |
| 18 | `20250310000001_organization_members_agency_role.sql` | 2025-03-10 | organization_members: роль agency |
| 19 | `20250311000000_organization_members_rls_fix.sql` | 2025-03-11 | RLS organization_members |
| 20 | `20250312000000_project_members_role_check.sql` | 2025-03-12 | project_members role CHECK |
| 21 | `20250313000000_project_monthly_plans.sql` | 2025-03-13 | project_monthly_plans + RLS |
| 22 | `20250314000000_project_monthly_plans_allow_project_admin.sql` | 2025-03-14 | RLS project_monthly_plans: project_admin |
| 23 | `20250315000000_projects_currency_and_exchange_rates.sql` | 2025-03-15 | projects.currency, exchange_rates |
| 24 | `20250317000000_project_monthly_plans_avg_checks.sql` | 2025-03-17 | project_monthly_plans: primary_avg_check, repeat_avg_check |
| 25 | `20250318000000_conversion_events_visitor_id.sql` | 2025-03-18 | conversion_events (CREATE + visitor_id, click_id, value, currency, …) |
| 26 | `20250319000000_visit_source_events_session_fbp_fbc.sql` | 2025-03-19 | visit_source_events: session_id, fbp, fbc |
| 27 | `20250320000000_projects_public_ingest_key.sql` | 2025-03-20 | projects.public_ingest_key |
| 28 | `20250321000000_ingest_rate_limits.sql` | 2025-03-21 | ingest_rate_limits + check_and_increment_ingest_rate |
| 29 | `20250322000000_projects_archived_reauth_tokens.sql` | 2025-03-22 | projects.archived, reauth_tokens + RLS |
| 30 | `20250323000000_redirect_links.sql` | 2025-03-23 | redirect_links, redirect_click_events |
| 31 | `20250324000000_redirect_links_clicks_fingerprint.sql` | 2025-03-24 | redirect_links: clicks_count, last_click_at; redirect_click_events: fingerprint_hash |
| 32 | `20250325000000_visit_source_events_visit_id.sql` | 2025-03-25 | visit_source_events: visit_id, click_id |
| 33 | `20250326000000_redirect_click_events_utm_id.sql` | 2025-03-26 | **Содержимое файла — только символ "C" (миграция сломана/неполная)** |
| 34 | `20250327000000_traffic_source_platform_columns.sql` | 2025-03-27 | traffic_source, traffic_platform в redirect_click_events, visit_source_events, conversion_events |
| 35 | `20250328000000_report_share_links.sql` | 2025-03-28 | report_share_links |
| 36 | `20250329000000_assisted_attribution_indexes.sql` | 2025-03-29 | (visitor_id, created_at) на visit_source_events и conversion_events |
| 37 | `20250330000000_conversion_events_session_id.sql` | 2025-03-30 | conversion_events: session_id; индексы session_id, user_external_id |

**Проверка порядка:** Нумерация по дате 20250307–20250330 без пропусков. Один и тот же день может иметь несколько миграций (000001–075000 07.03).  
**Дубликаты:** Индексы `idx_ad_accounts_integration_external` создаются в 000009 и 07100000 (одинаковое имя, IF NOT EXISTS — безопасно).  
**Конфликты:** См. раздел «Найденные проблемы» (ad_accounts: platform_account_id vs external_account_id, 08000000 aa.provider).

---

## 2️⃣ Список таблиц и структура

### Таблицы, созданные в миграциях

- **organizations** — id, name, slug, created_at, updated_at  
- **organization_members** — id, organization_id, user_id, role, created_at; UNIQUE(organization_id, user_id)  
- **integrations** — id, project_id, platform, created_at, updated_at; UNIQUE(project_id, platform)  
- **ad_accounts** — id, integration_id, **platform**, **platform_account_id**, name, currency, account_status, is_enabled, created_at, updated_at; UNIQUE(integration_id, platform_account_id)  
  - В коде и в миграциях 000009, 07100000, 07200000, 08000000 используются **external_account_id** и **provider** — см. проблемы.  
- **daily_ad_metrics** — id, ad_account_id, campaign_id, date, platform, spend, impressions, clicks, reach, cpm, cpc, ctr, leads, purchases, revenue, roas, created_at  
- **ad_account_settings** — id, ad_account_id, project_id, is_enabled, selected_for_reporting, sync_enabled, last_sync_*, created_at, updated_at  
- **sync_runs** — id, project_id, platform, ad_account_id, sync_type, status, started_at, finished_at, rows_written, error_message, meta, created_at  
- **integrations_auth** — id, integration_id, access_token, refresh_token, token_expires_at, scopes, meta, created_at, updated_at  
- **visit_source_events** — см. ниже  
- **project_invites** — id, organization_id, project_id, email, role, invite_type, token, status, expires_at, created_by, accepted_by, accepted_at, created_at  
- **project_monthly_plans** — id, project_id, month, year, sales_plan_count, sales_plan_budget, repeat_*, planned_revenue, created_by, updated_by, created_at, updated_at; UNIQUE(project_id, month, year)  
- **exchange_rates** — id, base_currency, quote_currency, rate, updated_at  
- **conversion_events** — см. ниже  
- **ingest_rate_limits** — id, project_id, ip, bucket, window_start, request_count, created_at, updated_at; UNIQUE(project_id, ip, bucket, window_start)  
- **reauth_tokens** — id, user_id, expires_at, created_at  
- **redirect_links** — id, project_id, token, destination_url, utm_source, utm_medium, utm_campaign, utm_content, utm_term, created_at, clicks_count, last_click_at; UNIQUE(token)  
- **redirect_click_events** — см. ниже  
- **report_share_links** — id, project_id, token, report_type, period_end_iso, report_snapshot, created_by, created_at, revoked_at  

### Таблицы, только изменяемые (создание не в этих миграциях)

- **projects** — в миграциях: organization_id, currency, public_ingest_key, archived  
- **integrations_meta** — в миграциях: integrations_id  
- **campaigns** — в миграциях: ad_accounts_id, external_campaign_id; backfill platform  
- **project_members** — только CHECK role  
- **meta_ad_accounts**, **meta_insights** — участвуют в backfill; создание не в этой папке  

---

### visit_source_events (полная структура по миграциям)

| Колонка | Тип | NOT NULL | Откуда |
|---------|-----|----------|--------|
| id | uuid | PK | 09000000 |
| visitor_id | text | YES | 09000000 |
| site_id | text | YES | 09000000 |
| landing_url | text | | 09000000 |
| referrer | text | | 09000000 |
| utm_source, utm_medium, utm_campaign, utm_content, utm_term | text | | 09000000 |
| gclid, fbclid, yclid, ttclid | text | | 09000000 |
| source_classification | text | YES, CHECK | 09000000 |
| touch_type | text | YES, DEFAULT 'last' | 09000000 |
| created_at | timestamptz | YES, DEFAULT now() | 09000000 |
| session_id | text | | 19000000 |
| fbp, fbc | text | | 19000000 |
| visit_id | text | | 25000000 |
| click_id | text | | 25000000 |
| traffic_source, traffic_platform | text | | 27000000 |

**Индексы:** visitor_id, site_id, created_at, (visitor_id, site_id), session_id, visit_id, click_id, traffic_source, (visitor_id, created_at).

---

### conversion_events (полная структура)

| Колонка | Тип | NOT NULL | Откуда |
|---------|-----|----------|--------|
| id | uuid | PK | 18000000 |
| project_id | uuid | YES | 18000000 |
| source | text | | 18000000 |
| event_name | text | YES | 18000000 |
| event_time | timestamptz | YES, DEFAULT now() | 18000000 |
| external_event_id | text | | 18000000 |
| user_external_id | text | | 18000000 |
| visitor_id | text | | 18000000 |
| click_id | text | | 18000000 |
| fbp, fbc | text | | 18000000 |
| utm_source, utm_medium, utm_campaign, utm_content, utm_term | text | | 18000000 |
| value | numeric(14,4) | | 18000000 |
| currency | text | | 18000000 |
| metadata | jsonb | YES, DEFAULT '{}' | 18000000 |
| created_at | timestamptz | YES, DEFAULT now() | 18000000 |
| session_id | text | | 30000000 |
| traffic_source, traffic_platform | text | | 27000000 |

**Индексы:** visitor_id, project_id, event_time, session_id, user_external_id, traffic_source, (visitor_id, created_at).  
**Нет индекса по click_id** — см. раздел 5.

---

### redirect_click_events (полная структура)

| Колонка | Тип | NOT NULL | Откуда |
|---------|-----|----------|--------|
| id | uuid | PK | 23000000 |
| project_id | uuid | YES, FK projects | 23000000 |
| redirect_link_id | uuid | FK redirect_links | 23000000 |
| bq_click_id | text | YES | 23000000 |
| destination_url | text | YES | 23000000 |
| full_url | text | | 23000000 |
| utm_source, utm_medium, utm_campaign, utm_content, utm_term | text | | 23000000 |
| fbclid, gclid, ttclid, yclid | text | | 23000000 |
| referrer, user_agent, ip | text | | 23000000 |
| fbp, fbc | text | | 23000000 |
| created_at | timestamptz | YES, DEFAULT now() | 23000000 |
| fingerprint_hash | text | | 24000000 |
| traffic_source, traffic_platform | text | | 27000000 |
| **utm_id** | **—** | **В коде есть insert utm_id; в миграциях колонки нет** (миграция 26000000 сломана) | **ПРОБЛЕМА** |

**Индексы:** project_id, redirect_link_id, bq_click_id, created_at, fingerprint_hash, traffic_source.

---

### redirect_links

| Колонка | Тип | NOT NULL |
|---------|-----|----------|
| id | uuid | PK |
| project_id | uuid | YES, FK |
| token | text | YES, UNIQUE |
| destination_url | text | YES |
| utm_source, utm_medium, utm_campaign, utm_content, utm_term | text | |
| created_at | timestamptz | YES |
| clicks_count | integer | YES, DEFAULT 0 |
| last_click_at | timestamptz | |

---

## 3️⃣ Соответствие кода и БД (ключевые таблицы)

### visit_source_events

Код использует: visitor_id, site_id, landing_url, referrer, utm_source, utm_medium, utm_campaign, utm_content, utm_term, gclid, fbclid, yclid, ttclid, session_id, fbp, fbc, click_id, visit_id, source_classification, touch_type, traffic_source, traffic_platform, created_at.  
**Все эти поля есть в миграциях.** Соответствие — полное.

### conversion_events

Код использует: project_id, source, event_name, event_time, external_event_id, user_external_id, visitor_id, session_id, click_id, fbp, fbc, utm_*, value, currency, metadata, traffic_source, traffic_platform, created_at.  
**Все перечисленные поля есть в миграциях.** Соответствие — полное.

### redirect_click_events

Код использует: project_id, redirect_link_id, bq_click_id, destination_url, full_url, utm_source, utm_medium, utm_campaign, utm_content, utm_term, **utm_id**, fbclid, gclid, ttclid, yclid, referrer, user_agent, ip, fbp, fbc, fingerprint_hash, traffic_source, traffic_platform, created_at.  
**Проблема:** колонка **utm_id** в миграциях не добавляется (файл 20250326000000 содержит только "C"). Вставка из `app/r/[token]/route.ts` передаёт utm_id — при отсутствии колонки в БД возможна ошибка.

### redirect_links

Код использует поля из миграций (id, project_id, token, destination_url, utm_*, created_at, clicks_count, last_click_at). Соответствие — полное.

---

## 4️⃣ Проверка недавно добавленных полей

| Таблица | Поле | В миграциях | Тип | Комментарий |
|---------|------|-------------|-----|-------------|
| conversion_events | session_id | 30000000 | text | Есть, индекс есть |
| conversion_events | user_external_id | 18000000 | text | Есть, индекс в 30000000 |
| conversion_events | click_id | 18000000 | text | Есть, индекса по click_id нет |
| conversion_events | value | 18000000 | numeric(14,4) | Есть |
| conversion_events | currency | 18000000 | text | Есть |
| visit_source_events | session_id | 19000000 | text | Есть, индекс есть |
| visit_source_events | visitor_id | 09000000 | text | Есть |
| visit_source_events | visit_id | 25000000 | text | Есть, индекс есть |
| visit_source_events | click_id | 25000000 | text | Есть, индекс есть |
| visit_source_events | fbp, fbc | 19000000 | text | Есть |

Все перечисленные поля присутствуют в миграциях и имеют ожидаемые типы.

---

## 5️⃣ Индексы

### Требуемые по ТЗ

- **visit_source_events (visitor_id, created_at)** — есть (29000000).  
- **conversion_events (visitor_id, created_at)** — есть (29000000).  
- **redirect_click_events (bq_click_id)** — есть (23000000).

### Отсутствующий индекс

- **conversion_events(click_id)** — в коде часто фильтруют/джойнят по click_id (attribution, data quality, debugger). Рекомендуется добавить индекс по click_id для ускорения запросов и джойнов с redirect_click_events.

---

## 6️⃣ Дубли и лишние поля

- **visit_id / visitor_id / click_id** — не дублируют друг друга:  
  - visitor_id — идентификатор посетителя (браузер/устройство).  
  - visit_id (bqvid) — один визит (сессия).  
  - click_id (bqcid) — связь с redirect_click_events.  
  Цепочка click → visit → registration → purchase поддерживается.

- **Лишних полей по коду не выявлено.** Все используемые в коде поля задействованы в атрибуции, отчётах или UI.

---

## 7️⃣ NULL и ограничения

- **visitor_id:** в visit_source_events — NOT NULL; в conversion_events — nullable (конверсия может прийти без визита).  
- **session_id:** везде nullable (добавлялся позже, старые записи без него).  
- **click_id:** везде nullable (не каждый визит/конверсия идут с клика по redirect).  
- **user_external_id:** в conversion_events — nullable.  
- Остальные UTM и click-id поля — nullable.  
- NOT NULL там, где задано в таблицах выше (id, project_id, event_name, bq_click_id, destination_url, token и т.д.).  
- FOREIGN KEY: redirect_click_events → projects, redirect_links; остальные связи указаны в разделе 2.

---

## 8️⃣ RLS и безопасность

- **Включён RLS:** organization_members, project_monthly_plans, reauth_tokens.  
- **Без RLS в миграциях:** visit_source_events, conversion_events, redirect_click_events, redirect_links, ad_accounts, daily_ad_metrics, campaigns и др.  

Доступ к трекинговым таблицам и рекламным данным идёт через **service role (admin)** в API; аутентификация на уровне приложения. Для мультитенантности фильтрация по project_id/site_id выполняется в запросах. Отдельное включение RLS для этих таблиц не обязательно, но при желании можно добавить политики по project_id/site_id для ограничения утечек при использовании anon/authenticated ключей.

---

## 9️⃣ Производительность

- **Отсутствующий индекс:** conversion_events(click_id) — см. раздел 5.  
- **Тяжёлые таблицы:** visit_source_events и conversion_events при росте объёма будут основными кандидатами на партиционирование по created_at или project_id.  
- **JOIN по click_id:** связь conversion_events ↔ redirect_click_events по click_id / bq_click_id без индекса по conversion_events.click_id может быть узким местом.  
- Составные индексы (visitor_id, created_at) для атрибуции и отчётов соответствуют типичным запросам.

---

## 🔟 Соответствие архитектуре трекинга (click → visit → registration → purchase)

- **redirect_click_events:** bq_click_id (bqcid) передаётся в URL; сохраняются UTM, fbclid, gclid, fbp, fbc и т.д.  
- **visit_source_events:** click_id = bqcid связывает визит с кликом; visit_id (bqvid) идентифицирует визит; visitor_id — устройство/браузер.  
- **conversion_events:** visitor_id, session_id, click_id, user_external_id связывают конверсию с визитом и кликом.  

Поля visitor_id, session_id, click_id, user_external_id присутствуют в нужных таблицах; цепочка в БД поддерживается. Исключение — возможное отсутствие колонки utm_id в redirect_click_events (см. раздел 3).

---

## 1️⃣1️⃣ Итог: найденные проблемы

1. **ad_accounts: несоответствие имён колонок**  
   В миграции 000003 таблица создаётся с **platform_account_id** и **platform**. В миграциях 000009, 07100000, 07200000 и в коде (OAuth, dashboard, sync) везде используются **external_account_id** и **provider**. Если в реальной БД колонки не переименовывались, миграции 000009 и 07100000 (уникальный индекс по external_account_id) и backfill в 07200000, 08000000 не применятся или приведут к ошибкам. Необходимо проверить фактическую схему ad_accounts в БД и при необходимости привести миграции или код к одному варианту (либо platform/platform_account_id, либо provider/external_account_id).

2. **backfill_campaigns_platform (08000000)**  
   В миграции используется `aa.provider`, тогда как в 000003 у ad_accounts объявлена колонка **platform**. Если переименования не было, здесь ошибка имени колонки.

3. **redirect_click_events.utm_id**  
   Код в `app/r/[token]/route.ts` записывает в колонку **utm_id**. Миграция `20250326000000_redirect_click_events_utm_id.sql` должна была добавлять эту колонку, но файл содержит только символ "C". Колонка в БД либо добавлена вручную, либо вставки падают. Рекомендуется восстановить миграцию (ADD COLUMN utm_id text) и применить.

4. **Файл миграции 20250326000000**  
   Содержимое файла — один символ "C". Миграция неполная/повреждена; её нужно восстановить (как минимум добавление utm_id в redirect_click_events).

5. **Нет индекса conversion_events(click_id)**  
   Запросы по click_id (атрибуция, отладка, отчёты) будут выполняться без поддержки индекса. Рекомендуется добавить индекс по click_id.

---

## Рекомендации по улучшению

1. **Привести к единому виду ad_accounts:** зафиксировать в одной миграции либо (platform, platform_account_id), либо (provider, external_account_id), и обновить все миграции и код под один вариант; при необходимости добавить миграцию переименования.  
2. **Восстановить 20250326000000:** добавить в redirect_click_events колонку utm_id text (и при необходимости индекс, если будут поиски по utm_id).  
3. **Добавить индекс:** `CREATE INDEX IF NOT EXISTS idx_conversion_events_click_id ON public.conversion_events(click_id);` (в новой миграции).  
4. **Проверить фактическую схему БД:** выполнить `\d ad_accounts`, `\d redirect_click_events` в psql (или аналог в Supabase) и сверить с этим отчётом.  
5. **Опционально:** документировать или вынести в миграции создание таблиц projects, project_members, integrations_meta, meta_ad_accounts, meta_insights, campaigns, если они создаются вручную или из другого репозитория, чтобы полная история схемы была в коде.

---

## Исправления после аудита (2025-03-31)

Критичные проблемы закрыты новыми безопасными миграциями без изменения старых файлов и без destructive changes. Подробности см. в [DATABASE_MIGRATIONS_FIXES.md](./DATABASE_MIGRATIONS_FIXES.md).

- **utm_id в redirect_click_events:** добавлена repair-миграция `20250331000001_redirect_click_events_utm_id_repair.sql` (ADD COLUMN IF NOT EXISTS).
- **Индекс conversion_events(click_id):** добавлена миграция `20250331000002_conversion_events_click_id_index.sql`.
- **ad_accounts (provider / external_account_id):** добавлена repair-миграция `20250307000003_repair_ad_accounts_provider_external.sql` для совместимости новых сред с последующими миграциями и кодом.
- **Backfill 08000000:** не изменялся; после repair ad_accounts выполняется корректно на новой БД.

---

*Аудит выполнен без внесения изменений в код и базу данных. Исправления — только новые миграции и документация.*
