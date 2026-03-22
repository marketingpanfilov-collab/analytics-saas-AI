# Backend Audit Report — analytics-saas

**Date:** 2026-03-06  
**Scope:** DB integrity, sync logic (Meta/Google), dashboard API, access control, production stability.

---

## A. Executive summary

Backend в целом логически согласован: канонические данные в `daily_ad_metrics` + view `daily_ad_metrics_campaign` для агрегации без двойного учёта, sync с delete-then-insert по диапазону и in-process lock. При этом есть **критические риски**: отсутствие проверки доступа к проекту на всех dashboard и sync API (утечка данных между проектами), возможный fallback metrics на глобальную таблицу без фильтра по project_id, рассинхрон summary/timeseries при использовании RPC fallback. Целостность БД улучшена миграциями из DB_AUDIT_AND_FIX_PLAN; остаются риски по legacy campaigns с `ad_accounts_id` IS NULL и по колонкам/именам (project_id в insert, account_name vs name).

**Top critical risks:**
1. **Dashboard и sync API не проверяют доступ к проекту** — любой, кто знает project_id, может читать/запускать sync.
2. **Fallback /api/dashboard/metrics** читает `dashboard_meta_metrics` без фильтра по project_id — риск возврата чужих данных при пустом canonical.
3. **Timeseries RPC fallback** не получает sources/accountIds — при fallback итоги по summary (canonical, с фильтром) и по chart (rpc, без фильтра) могут расходиться.
4. **Sync lock только in-process** — при нескольких инстансах приложения возможны параллельные sync одного и того же диапазона и дубли/конфликты.

---

## B. Найденные проблемы

### B.1. Access / auth / project isolation

| Severity | Title | Location | Symptoms | Root cause | Impact | Reproduce | Fix |
|----------|--------|----------|----------|------------|--------|-----------|-----|
| **Critical** | Dashboard API не проверяет доступ к проекту | `/api/dashboard/summary`, `timeseries`, `kpi`, `accounts`, `source-options`, `sync`, `metrics`, `timeseries-conversions`, `refresh` | Любой клиент с project_id получает данные проекта | Нет вызова `requireProjectAccess` / `getCurrentUser`; project_id берётся только из query | Утечка данных между проектами; возможность перебора project_id | GET `/api/dashboard/summary?project_id=<uuid>&start=...&end=...` с UUID чужого проекта | Во всех GET/POST dashboard и sync: получить user через supabase.auth.getUser(); при наличии user — вызвать requireProjectAccess(user.id, projectId); при null возвращать 403. Для публичных share-ссылок оставить отдельный путь по token. |
| **Critical** | Sync API не проверяет доступ к проекту | `/api/oauth/meta/insights/sync`, `/api/oauth/google/insights/sync` | Любой может запустить sync для любого project_id + ad_account_id | Только валидация UUID/формата; нет проверки membership | Запись в БД от имени «чужого» проекта; расход квот API; потенциальная порча данных | GET sync URL с project_id и ad_account_id другого проекта | Та же схема: auth.getUser() + requireProjectAccess перед выполнением sync. |
| **High** | POST /api/dashboard/sync без auth | `app/api/dashboard/sync/route.ts` | Любой может вызвать массовый sync по project_id | Нет проверки пользователя и доступа к проекту | Несанкционированная нагрузка на Meta/Google API и БД | POST с project_id и диапазоном дат | Обязательная auth + requireProjectAccess перед циклом по аккаунтам. |

---

### B.2. DB and data integrity

| Severity | Title | Location | Symptoms | Root cause | Impact | Reproduce | Fix |
|----------|--------|----------|----------|------------|--------|-----------|-----|
| **Medium** | daily_ad_metrics: insert передаёт project_id | Meta/Google sync: `admin.from("daily_ad_metrics").insert(rows)` с полем `project_id` в объектах | Лишнее поле в payload; в PG колонки project_id нет | Код добавляет project_id «для контекста»; таблица не содержит этой колонки | PostgREST обычно игнорирует лишние ключи — вставка проходит; возможна путаница при поддержке | Запуск Meta/Google sync и просмотр логов/сетевого запроса | Удалить `project_id` из всех объектов, передаваемых в insert daily_ad_metrics; при необходимости фильтрация по проекту — через join с ad_accounts → integrations. |
| **Low** | ad_accounts: возможное несоответствие имени колонки | `app/api/dashboard/accounts/route.ts` — select `account_name` | В миграциях у ad_accounts есть только `name` | Код ожидает `account_name` | Если колонки account_name нет — в ответе null или ошибка | GET `/api/dashboard/accounts?project_id=...` и проверить поля в ответе | Проверить в БД наличие `account_name`; если есть только `name` — в select использовать `name` и в маппинге отдавать как name или account_name. |
| **Low** | visit_source_events: site_id vs project_id | KPI, timeseries-conversions, source-options — `.eq("site_id", projectId)` | Разные имена для одной сущности (проект) | Историческая схема: site_id в visit_source_events, project_id в conversion_events | Риск путаницы; при миграции на project_id нужно обновить и код | — | Документировать, что site_id = project_id; при унификации схемы переименовать в миграции и обновить код. |

**Примечание.** Дубли campaigns/daily_ad_metrics, orphan-записи и ad_accounts_id IS NULL уже покрыты планом в DB_AUDIT_AND_FIX_PLAN.md и миграциями 20250604–20250607; при применении миграций и выполнении проверок из DB_VERIFICATION_QUERIES.md целостность должна быть восстановлена.

---

### B.3. Sync logic

| Severity | Title | Location | Symptoms | Root cause | Impact | Reproduce | Fix |
|----------|--------|----------|----------|------------|--------|-----------|-----|
| **Medium** | Meta: campaigns upsert не выставляет ad_accounts_id | `app/api/oauth/meta/insights/sync/route.ts` — upsert campaigns с project_id, meta_campaign_id, ad_account_id, name | Новые/обновлённые Meta-кампании остаются с ad_accounts_id IS NULL | Upsert по (project_id, meta_campaign_id); колонка ad_accounts_id не передаётся | Увеличение числа «legacy» строк с ad_accounts_id IS NULL; сложность последующего NOT NULL | Запуск Meta insights sync для аккаунта с новыми кампаниями; проверить campaigns.ad_accounts_id | При формировании campaignUpsertRows резолвить canonical ad_accounts.id по project_id + ad_account_id (act_xxx) и добавлять ad_accounts_id в объекты upsert. |
| **Medium** | Sync lock только in-process | `app/lib/syncLock.ts` — Map в памяти | При 2+ инстансах приложения два запроса с одним ключом выполняются параллельно | Lock не распределённый | Два одновременных delete+insert по одному диапазону → возможны дубли или constraint violation | Два инстанса, одновременно вызвать sync для одного (platform, ad_account_id, range) | Ввести распределённый lock (Redis/DB advisory lock) по тому же ключу; либо оставить как есть и документировать ограничение «один инстанс для sync». |
| **Low** | Google: upsert campaigns onConflict | `app/api/oauth/google/insights/sync/route.ts` — `onConflict: "ad_accounts_id,external_campaign_id"` | При отсутствии constraint в БД upsert может вести себя как insert | Миграция с UNIQUE могла не быть применена | Дубли кампаний Google | Запуск Google sync до применения 20250602000000/20250605000000 | Убедиться, что миграции с UNIQUE применены; в коде при ошибке конфликта логировать и не считать фатальной (уже есть non-fatal handling). |
| **Low** | Meta: fallback account-level при пустом accList | Meta sync: блок «Canonical fallback» при accList.length === 0 и allCampaignRows.length > 0 | Пишутся и campaign-level, и account-level (агрегат по кампаниям) за тот же период | По дизайну: дашборд использует только campaign-level (view), чтобы не дублировать spend | Двойной учёт только если кто-то агрегирует по всей таблице без фильтра campaign_id IS NOT NULL | — | Оставить как есть; убедиться, что все запросы к «totals» идут через daily_ad_metrics_campaign или явный фильтр campaign_id IS NOT NULL. |

---

### B.4. Dashboard API

| Severity | Title | Location | Symptoms | Root cause | Impact | Reproduce | Fix |
|----------|--------|----------|----------|------------|--------|-----------|-----|
| **High** | Metrics fallback без project_id | `app/api/dashboard/metrics/route.ts` — fallback на `dashboard_meta_metrics` без фильтра по project_id | При пустом canonical возвращаются все строки таблицы | Legacy таблица/view без проектной привязки; код не передаёт project_id | Возврат данных другого проекта или глобального среза | project_id с нулевым canonical + наличие строк в dashboard_meta_metrics | Не использовать глобальный fallback; при пустом canonical возвращать пустой массив и source: "daily_ad_metrics (canonical)", либо реализовать fallback с фильтром по project_id (через join с ad_accounts/integrations). |
| **High** | Timeseries RPC fallback без sources/accountIds | `app/api/dashboard/timeseries/route.ts` — вызов `dashboard_meta_timeseries(p_project_id, p_start, p_end)` без фильтров | Summary с sources/accountIds считает по canonical; chart при fallback — по RPC «всё по проекту» | RPC не принимает sources/accountIds | Расхождение итогов summary и графика при выборе источника/аккаунтов | Запросить timeseries с sources=google при отсутствии campaign-level по Google; canonical вернёт пусто → сработает RPC с полными данными | Либо убрать RPC fallback и при пустом canonical возвращать пустой points; либо расширить RPC параметрами (sources, account_ids) и передавать их из route. |
| **Medium** | Кэш после sync не инвалидируется по диапазону | summary/timeseries/metrics: cache set только при !didSync или !isHistoricalPartial | После завершения исторического sync старый кэш по тому же ключу может остаться | Инвалидация по ключу (project_id, start, end, sources, accounts) не вызывается при успешном sync | Пользователь видит старые цифры до истечения TTL | Запросить summary → запустить sync на тот же диапазон → снова запросить summary до TTL | При успешном ответе sync (dashboard/sync или backfill) инвалидировать соответствующие ключи кэша (по project_id и диапазонам) или не кэшировать ответы с «partial» backfill до следующего запроса. |
| **Low** | RPC dashboard_meta_timeseries контракт | timeseries/route.ts | Неясно, считает ли RPC по campaign-level или по account-level; есть ли фильтр по platform | RPC может быть legacy под meta_insights | Риск двойного учёта или расхождения с canonical | — | Проверить определение RPC в миграциях; привести к «только campaign-level по project через ad_accounts» и документировать. |

---

### B.5. Stability / production risks

| Severity | Title | Location | Symptoms | Root cause | Impact | Reproduce | Fix |
|----------|--------|----------|----------|------------|--------|-----------|-----|
| **Medium** | Race при delete+insert в одном sync | Meta/Google: delete по (ad_account_id, dates) затем insert | Между delete и insert другой процесс может прочитать «пусто»; при сбое после delete — потеря данных за диапазон | Нет транзакции «delete + insert» в одном запросе | Потеря данных при падении между delete и insert | Имитировать падение после delete (e.g. kill process) | По возможности объединять в одну транзакцию или использовать upsert с ON CONFLICT по (ad_account_id, campaign_id, date) / (ad_account_id, date) вместо delete+insert. |
| **Low** | Backfill trigger — внутренний fetch без cookie | `app/lib/dashboardBackfill.ts` — fetch(syncUrlStr) | Вызов /api/dashboard/sync идёт без передачи auth cookie/header | Backfill вызывается с сервера при обработке GET summary/timeseries | Если позже sync начнёт требовать auth, backfill перестанет поднимать sync | — | При введении auth на POST /api/dashboard/sync передавать серверный токен или внутренний заголовок и проверять его на sync route. |
| **Low** | Рост syncPromises Map при сбоях | dashboardBackfill: syncPromises.set(key, promise); promise.finally(delete) | При исключении до finally ключ может не удалиться | Редкий сценарий | Утечка памяти; повторные триггеры не дедуплицируются | — | В finally гарантированно вызывать syncPromises.delete(key); обернуть promise в try/finally. |

---

## C. DB fixes

- **Уже запланированы (DB_AUDIT_AND_FIX_PLAN.md):**  
  - 20250604000000 — created_at для campaigns  
  - 20250605000000 — дедуп Google campaigns, перепривязка метрик, UNIQUE  
  - 20250606000000 — дедуп daily_ad_metrics  
  - 20250607000000 — аудит/backfill ad_accounts_id IS NULL, опционально удаление неиспользуемых  

- **Рекомендуется дополнительно:**  
  - Убедиться, что в прод применены все миграции с UNIQUE/partial unique для campaigns и daily_ad_metrics.  
  - После обнуления количества campaigns с ad_accounts_id IS NULL (и проверки верификационными запросами) рассмотреть `ALTER TABLE campaigns ALTER COLUMN ad_accounts_id SET NOT NULL` отдельной миграцией.  
  - Не добавлять project_id в daily_ad_metrics без явной необходимости; при необходимости — отдельная миграция + обновление всех insert в sync.

---

## D. Code fixes (по приоритету)

1. **Критично**  
   - **Auth на dashboard и sync:** во всех route: summary, timeseries, kpi, accounts, source-options, metrics, timeseries-conversions, refresh, sync (POST), meta/insights/sync, google/insights/sync — получать пользователя, при наличии вызывать `requireProjectAccess(user.id, projectId)`, при отсутствии доступа возвращать 403.  
   - **Metrics fallback:** убрать fallback на `dashboard_meta_metrics` без project_id или реализовать безопасный fallback с фильтром по проекту.  
   - **Timeseries fallback:** убрать RPC fallback или расширить его параметрами sources/accountIds и передавать их; иначе при пустом canonical возвращать пустой массив points.

2. **Высокий приоритет**  
   - **Meta campaigns ad_accounts_id:** при upsert кампаний в Meta sync подставлять ad_accounts_id (canonical ad_accounts.id по project_id + ad_account_id).  
   - **Кэш:** инвалидировать кэш дашборда по затронутым project_id/диапазонам после успешного sync или не кэшировать ответы с historical backfill до следующего запроса.

3. **Средний приоритет**  
   - Убрать `project_id` из объектов insert в daily_ad_metrics в Meta и Google sync.  
   - Рассмотреть объединение delete+insert в транзакцию или переход на upsert по конфликту для daily_ad_metrics.  
   - Документировать или реализовать распределённый sync lock при многозначности приложения.

4. **Низкий приоритет**  
   - Проверить и при необходимости исправить выборку `account_name` в dashboard/accounts (заменить на `name` или добавить колонку).  
   - Документировать site_id = project_id для visit_source_events.  
   - Проверить определение RPC dashboard_meta_timeseries и привести к одному правилу агрегации (campaign-level, по проекту).

---

## E. Safe rollout plan

1. **Без изменения контракта API**  
   - Применить все миграции из DB_AUDIT_AND_FIX_PLAN (20250604–20250607).  
   - Выполнить запросы из DB_VERIFICATION_QUERIES.md и убедиться в отсутствии дублей и orphan.  
   - В коде: убрать project_id из insert daily_ad_metrics; поправить Meta campaigns ad_accounts_id при upsert; исправить metrics fallback и timeseries RPC fallback (без добавления auth пока).

2. **Включение auth**  
   - Добавить getCurrentUser + requireProjectAccess во все dashboard и sync routes.  
   - Для backfill: либо передавать внутренний серверный токен при вызове POST /api/dashboard/sync, либо исключить sync route из обязательной auth и оставить его только для внутреннего вызова с проверкой по заголовку/секрету.  
   - Прогнать сценарии: без auth — 401/403; с auth и чужим project_id — 403; с auth и своим project_id — 200.

3. **Кэш и RPC**  
   - Внедрить инвалидацию кэша после sync.  
   - Зафиксировать и при необходимости обновить контракт RPC dashboard_meta_timeseries (и при необходимости отключить fallback).

4. **Масштабирование и надёжность**  
   - При переходе на несколько инстансов — ввести распределённый lock для sync и, при необходимости, транзакционный или upsert-based подход для daily_ad_metrics.

5. **Ручные проверки после деплоя**  
   - Summary и timeseries для одного и того же диапазона и фильтров (all sources, google, meta) — совпадение итогов.  
   - Диапазоны: 2026-02-01 → 2026-03-16; один день 2026-03-16.  
   - Сценарии с пустым canonical (например, только account-level по Google): явное поведение и отсутствие «чужих» данных в fallback.

---

*Отчёт подготовлен по результатам анализа кода и миграций; для точных выводов по дублям и orphan в проде необходимо выполнить запросы из DB_VERIFICATION_QUERIES.md на реальной БД.*
