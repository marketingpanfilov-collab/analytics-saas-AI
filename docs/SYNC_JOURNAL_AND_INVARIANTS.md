# Sync journal and invariant checks

Документация по расширенному журналу синхронизаций (`sync_runs`) и таблице проверок инвариантов (`data_invariant_checks`). Изменения внедрены без смены контрактов dashboard API и без перехода на upsert.

---

## 1. sync_runs

Таблица журнала запусков синхронизации. Используется для наблюдаемости, отладки и отчётов по последнему sync.

### Legacy-поля (не удаляются)

| Поле | Тип | Описание |
|------|-----|----------|
| `id` | uuid | PK |
| `project_id` | uuid | Проект |
| `platform` | text | `meta`, `google`, … |
| `ad_account_id` | uuid (nullable) | ID в `ad_accounts` |
| `sync_type` | text | Например `insights` |
| `status` | text | `running`, `ok`, `error` |
| `started_at` | timestamptz | Время старта |
| `finished_at` | timestamptz | Время завершения |
| `rows_written` | integer | Сколько строк «записано» (legacy счётчик) |
| `error_message` | text | Сообщение об ошибке (при status = error) |
| `meta` | jsonb | Произвольный контекст (period, pages, …) |
| `created_at` | timestamptz | Создание записи |

### Новые поля (hardening)

| Поле | Тип | Описание |
|------|-----|----------|
| `date_start` | date | Начало диапазона дат sync (YYYY-MM-DD) |
| `date_end` | date | Конец диапазона дат sync |
| `rows_deleted` | integer | Сколько строк удалено (delete-then-insert) |
| `rows_inserted` | integer | Всего вставлено строк в `daily_ad_metrics` |
| `campaign_rows_inserted` | integer | Вставлено строк по кампаниям (campaign_id IS NOT NULL) |
| `account_rows_inserted` | integer | Вставлено строк по аккаунту (campaign_id IS NULL) |
| `error_text` | text | Дубликат сообщения об ошибке (наравне с error_message) |
| `metadata` | jsonb | Структурированный контекст (по умолчанию `{}`) |

Индексы:

- `idx_sync_runs_project_started_at_desc` — по `(project_id, started_at DESC)`
- `idx_sync_runs_platform_account_range_started_at_desc` — по `(platform, ad_account_id, date_start, date_end, started_at DESC)`

При успехе заполняются оба набора полей (legacy + новые); при ошибке пишутся и `error_message`, и `error_text`.

---

## 2. data_invariant_checks

Таблица результатов пост-синк проверок инвариантов. Одна запись — один запуск одной проверки.

| Поле | Тип | Описание |
|------|-----|----------|
| `id` | uuid | PK |
| `project_id` | uuid | Проект |
| `check_code` | text | Код проверки (см. ниже) |
| `severity` | text | `critical` или `warning` |
| `status` | text | `ok` или `failed` |
| `details` | jsonb | Контекст: ad_account_id, platform, date_start, date_end, счётчики и т.д. |
| `checked_at` | timestamptz | Время выполнения проверки |

Индекс: `idx_data_invariant_checks_project_checked_at` по `(project_id, checked_at DESC)`.

---

## 3. Классификация проверок

### Critical

- **duplicate_campaign_level_metrics** — дубли по `(ad_account_id, campaign_id, date)` при `campaign_id IS NOT NULL`.
- **duplicate_account_level_metrics** — дубли по `(ad_account_id, date)` при `campaign_id IS NULL`.
- **orphan_campaign_metrics** — строки в `daily_ad_metrics` с непустым `campaign_id`, для которых нет записи в `campaigns`.
- **orphan_ad_account_metrics** — `ad_account_id` из метрик не найден в `ad_accounts`.

### Warning

- **zero_rows_after_sync** — после sync в диапазоне `[date_start, date_end]` для данного `ad_account_id` нет ни одной строки в `daily_ad_metrics`.

Проверки выполняются после успешного завершения sync; ошибка внутри проверки не прерывает sync, только логируется и фиксируется в `data_invariant_checks` как `failed` с `details.error`.

---

## 4. Примеры SQL

### Последний sync по аккаунту

```sql
SELECT id, project_id, platform, ad_account_id, sync_type, status,
       started_at, finished_at, date_start, date_end,
       rows_written, rows_inserted, campaign_rows_inserted, account_rows_inserted, rows_deleted,
       error_message, error_text
FROM public.sync_runs
WHERE ad_account_id = :ad_account_id
ORDER BY started_at DESC
LIMIT 1;
```

### Failed invariant checks за последние N дней

```sql
SELECT id, project_id, check_code, severity, status, details, checked_at
FROM public.data_invariant_checks
WHERE project_id = :project_id
  AND status = 'failed'
  AND checked_at >= now() - interval '7 days'
ORDER BY checked_at DESC;
```

### Sync runs по диапазону дат (по started_at)

```sql
SELECT id, project_id, platform, ad_account_id, status, date_start, date_end,
       rows_inserted, campaign_rows_inserted, account_rows_inserted, started_at, finished_at
FROM public.sync_runs
WHERE project_id = :project_id
  AND started_at >= :since
  AND started_at <= :until
ORDER BY started_at DESC;
```

### Критичные проверки за последние 24 часа

```sql
SELECT check_code, severity, status, details->>'ad_account_id' AS ad_account_id,
       details->>'date_start' AS date_start, details->>'date_end' AS date_end,
       checked_at
FROM public.data_invariant_checks
WHERE project_id = :project_id
  AND severity = 'critical'
  AND status = 'failed'
  AND checked_at >= now() - interval '24 hours'
ORDER BY checked_at DESC;
```

---

## 5. Helper-слой и интеграция

- **app/lib/syncRuns.ts** — `startSyncRun`, `finishSyncRunSuccess`, `finishSyncRunError`, `recordInvariantCheck`. Не бросают исключений при ошибках записи в БД; пишут в консоль с префиксами `[SYNC_RUNS_*]` и `[SYNC_RUNS_RECORD_INVARIANT_ERROR]`.
- **app/lib/postSyncInvariantChecks.ts** — `runPostSyncInvariantChecks(admin, { projectId, adAccountId, platform, dateStart, dateEnd })`. Выполняет все пять проверок и пишет результаты в `data_invariant_checks` через `recordInvariantCheck`.
- **Meta insights sync** (`app/api/oauth/meta/insights/sync/route.ts`): при старте вызывается `startSyncRun` с `date_start`/`date_end` и метаданными; при успехе — `finishSyncRunSuccess` с существующими счётчиками и затем `runPostSyncInvariantChecks`; при любой ошибке — `finishSyncRunError` (заполняются и `error_message`, и `error_text`).
- **Google insights sync** (`app/api/oauth/google/insights/sync/route.ts`): то же — `startSyncRun` с диапазоном дат, при успехе `finishSyncRunSuccess` (account_rows_inserted = accountRowsWritten + zeroDaysInserted, campaign_rows_inserted = campaignRowsWritten) и `runPostSyncInvariantChecks`; при ошибке — `finishSyncRunError`.

Логика sync (delete-then-insert) и контракты dashboard API не менялись.

---

## 6. Отчёт о внедрении (Sync journal + invariant checks hardening)

### 6.1 Изменённые файлы

- `app/api/oauth/meta/insights/sync/route.ts` — переход на startSyncRun/finishSyncRunSuccess/finishSyncRunError, учёт account_rows_inserted, вызов runPostSyncInvariantChecks после успеха.
- `app/api/oauth/google/insights/sync/route.ts` — то же для Google: startSyncRun с date_start/date_end, finishSyncRunSuccess с новыми счётчиками, finishSyncRunError на ошибках, runPostSyncInvariantChecks после успеха.

### 6.2 Добавленные миграции

- `supabase/migrations/20250608000000_sync_runs_hardening.sql` — новые колонки в sync_runs (date_start, date_end, rows_deleted, rows_inserted, campaign_rows_inserted, account_rows_inserted, error_text, metadata) и два индекса.
- `supabase/migrations/20250609000000_data_invariant_checks.sql` — таблица data_invariant_checks и индекс по (project_id, checked_at DESC).

### 6.3 Новые helper-функции

- **syncRuns.ts:** `startSyncRun`, `finishSyncRunSuccess`, `finishSyncRunError`, `recordInvariantCheck`.
- **postSyncInvariantChecks.ts:** `runPostSyncInvariantChecks`.

### 6.4 Внедрённые проверки (checks)

1. **duplicate_campaign_level_metrics** (critical) — дубли по (ad_account_id, campaign_id, date), campaign_id IS NOT NULL.
2. **duplicate_account_level_metrics** (critical) — дубли по (ad_account_id, date), campaign_id IS NULL.
3. **orphan_campaign_metrics** (critical) — метрики с campaign_id, для которых нет кампании в campaigns.
4. **orphan_ad_account_metrics** (critical) — ad_account_id не найден в ad_accounts.
5. **zero_rows_after_sync** (warning) — ноль строк в диапазоне после sync.

### 6.5 Интеграция в Meta sync

- Старт: startSyncRun с project_id, platform='meta', ad_account_id=canonicalAdAccountId, sync_type='insights', date_start=since, date_end=until, metadata (tz).
- Успех: finishSyncRunSuccess с rowsWritten, rowsInserted, campaignRowsInserted=totalSaved, accountRowsInserted (накоплено по accMetricsRows, zeroRows, accFallbackRows), rowsDeleted=0, meta; затем runPostSyncInvariantChecks при наличии canonicalAdAccountId.
- Ошибка: finishSyncRunError с error_message и error_text перед возвратом ответа.

### 6.6 Интеграция в Google sync

- Старт: startSyncRun с platform='google', date_start=since, date_end=until и теми же project_id, ad_account_id, sync_type.
- Успех: finishSyncRunSuccess с rowsWritten=totalRows, rowsInserted=totalRows, campaignRowsInserted=campaignRowsWritten, accountRowsInserted=accountRowsWritten+zeroDaysInserted, rowsDeleted=0, meta; затем runPostSyncInvariantChecks.
- Ошибка: finishSyncRunError перед возвратом ответа.

### 6.7 Оставшиеся legacy-риски

- В sync_runs сохранены старые колонки (rows_written, error_message, meta); ad_account_id по-прежнему nullable.
- campaigns.ad_accounts_id остаётся nullable; destructive cleanup legacy campaigns не выполнялся.
- Delete-then-insert не переписывался на upsert; контракты dashboard API не менялись.

### 6.8 SQL для проверки после деплоя

1. Убедиться, что новые колонки есть в sync_runs:
   ```sql
   SELECT column_name, data_type FROM information_schema.columns
   WHERE table_schema = 'public' AND table_name = 'sync_runs'
   ORDER BY ordinal_position;
   ```
2. Убедиться, что таблица data_invariant_checks создана:
   ```sql
   SELECT * FROM public.data_invariant_checks LIMIT 0;
   ```
3. После одного успешного Meta/Google sync проверить запись в sync_runs (date_start, date_end, rows_inserted, campaign_rows_inserted, account_rows_inserted заполнены).
4. Проверить появление записей в data_invariant_checks после того же sync:
   ```sql
   SELECT check_code, severity, status, details, checked_at
   FROM public.data_invariant_checks
   WHERE project_id = :project_id
   ORDER BY checked_at DESC LIMIT 10;
   ```
5. При необходимости — запросы из раздела «Примеры SQL» выше (последний sync по аккаунту, failed checks за N дней).
