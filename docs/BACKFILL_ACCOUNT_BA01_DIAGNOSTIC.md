# Диагностика: account ba01cfd3 (15 дней покрытия вместо 43)

**Контекст:** Диапазон 2026-02-01 → 2026-03-15. Один enabled account покрыт полностью (43 дня), второй — частично (15 дней). Цель: выяснить, почему `ba01cfd3-3dfb-4949-9d7d-f09327600e15` не дозаполнил февраль при historical backfill.

Ниже — запросы для Supabase SQL Editor (или любого клиента к БД). Подставьте при необходимости `ad_account_id = 'ba01cfd3-3dfb-4949-9d7d-f09327600e15'` и диапазон дат.

---

## 1. Провайдер и идентификаторы аккаунта

```sql
SELECT
  id,
  COALESCE(provider, platform) AS provider,
  COALESCE(external_account_id, platform_account_id) AS external_id,
  name,
  integration_id,
  created_at
FROM public.ad_accounts
WHERE id = 'ba01cfd3-3dfb-4949-9d7d-f09327600e15';
```

**Что смотреть:** `provider` = `meta` или `google`; `external_id` — тот, что уходит в sync (act_* или customer id).

---

## 2. Строки в daily_ad_metrics за 2026-02-01 → 2026-03-15

### 2a. Количество по дням и по типу (account vs campaign)

```sql
SELECT
  date,
  COUNT(*) FILTER (WHERE campaign_id IS NULL) AS account_level_rows,
  COUNT(*) FILTER (WHERE campaign_id IS NOT NULL) AS campaign_level_rows,
  COUNT(*) AS total
FROM public.daily_ad_metrics
WHERE ad_account_id = 'ba01cfd3-3dfb-4949-9d7d-f09327600e15'
  AND date >= '2026-02-01'
  AND date <= '2026-03-15'
GROUP BY date
ORDER BY date;
```

**Что смотреть:** Сколько дней имеют хотя бы одну строку (account или campaign). Ожидаем 43 дня при полном покрытии; 15 строк = 15 дней.

### 2b. Список дат с покрытием (distinct dates)

```sql
SELECT COUNT(DISTINCT date) AS distinct_days,
       array_agg(DISTINCT date ORDER BY date) AS dates
FROM public.daily_ad_metrics
WHERE ad_account_id = 'ba01cfd3-3dfb-4949-9d7d-f09327600e15'
  AND date >= '2026-02-01'
  AND date <= '2026-03-15';
```

### 2c. Какие даты отсутствуют в диапазоне

```sql
WITH range_dates AS (
  SELECT generate_series(
    '2026-02-01'::date,
    '2026-03-15'::date,
    '1 day'::interval
  )::date AS d
),
covered AS (
  SELECT DISTINCT date FROM public.daily_ad_metrics
  WHERE ad_account_id = 'ba01cfd3-3dfb-4949-9d7d-f09327600e15'
    AND date >= '2026-02-01'
    AND date <= '2026-03-15'
)
SELECT r.d AS missing_date
FROM range_dates r
LEFT JOIN covered c ON c.date = r.d
WHERE c.date IS NULL
ORDER BY r.d;
```

**Что смотреть:** Список дат без покрытия = missing interval для backfill.

---

## 3. sync_runs по этому ad_account_id за диапазон

```sql
SELECT
  id,
  platform,
  sync_type,
  status,
  started_at,
  finished_at,
  rows_written,
  error_message,
  meta->>'since' AS meta_since,
  meta->>'until' AS meta_until,
  meta
FROM public.sync_runs
WHERE ad_account_id = 'ba01cfd3-3dfb-4949-9d7d-f09327600e15'
  AND started_at >= '2026-02-01'
  AND started_at < '2026-03-16'
ORDER BY started_at DESC;
```

**Что смотреть:**

- Есть ли записи за missing interval (февраль). Если нет — sync по этому аккаунту за февраль не вызывался или вызывался с другим `ad_account_id`.
- `status`: `ok` / `error` / `running`.
- `rows_written`: сколько строк записано.
- `error_message`: причина падения.
- `meta_since`, `meta_until`: диапазон, который sync пытался обработать.

---

## 4. sync_runs за весь период (без фильра по дате старта)

Чтобы увидеть все запуски по аккаунту, в т.ч. с `meta.since/until` в феврале:

```sql
SELECT
  id,
  platform,
  sync_type,
  status,
  started_at,
  finished_at,
  rows_written,
  error_message,
  meta->>'since' AS meta_since,
  meta->>'until' AS meta_until
FROM public.sync_runs
WHERE ad_account_id = 'ba01cfd3-3dfb-4949-9d7d-f09327600e15'
ORDER BY started_at DESC
LIMIT 50;
```

---

## 5. Сводка: включён ли аккаунт в проект

```sql
SELECT
  s.project_id,
  s.ad_account_id,
  s.is_enabled,
  aa.provider,
  aa.external_account_id
FROM public.ad_account_settings s
JOIN public.ad_accounts aa ON aa.id = s.ad_account_id
WHERE s.ad_account_id = 'ba01cfd3-3dfb-4949-9d7d-f09327600e15';
```

**Что смотреть:** `is_enabled = true` и что `ad_account_id` в `ad_account_settings` совпадает с тем, по которому считаем покрытие в `daily_ad_metrics`.

---

## Интерпретация

1. **Провайдер** (п.1): Meta или Google — от этого зависит, какой sync (meta/insights или google/insights) должен был заполнить диапазон.
2. **Покрытие** (п.2): 15 distinct days → 28 дней в диапазоне без строк; п.2c даёт точный список missing dates.
3. **sync_runs** (п.3–4):
   - Если записей за февраль **нет** — backfill мог не вызывать sync по этому аккаунту (например, другой project_id, или только один аккаунт в вызове).
   - Если есть с `status = error` — смотреть `error_message` и `meta`.
   - Если есть `status = ok` и `meta_since`/`meta_until` покрывают февраль, но в `daily_ad_metrics` февраль пустой — ошибка записи (или запись под другим `ad_account_id`).
4. **Zero-fill:** для дней, когда API вернул пусто, sync должен писать account-level zero rows. Если sync был `ok` и `rows_written > 0`, но дат в БД нет — проверить, что в sync используется тот же `ad_account_id` (UUID из `ad_accounts.id`), что и в `getEnabledAdAccountIds` / coverage.

После выполнения запросов можно зафиксировать: provider, список missing dates, наличие/статус sync_runs за февраль и вывод, почему этот account не дозаписал февраль.
