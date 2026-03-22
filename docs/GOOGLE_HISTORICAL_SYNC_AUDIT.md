# Google historical sync — точечный аудит и правки

## Data retrieval audit (2026-03)

В `app/api/oauth/google/insights/sync/route.ts` добавлен точечный аудит пути данных:

1. **Запросы к API**
   - `[GOOGLE_SYNC_ACCOUNT_QUERY]` — точный GAQL для account-level, `since`, `until`, `customer_id`.
   - `[GOOGLE_SYNC_CAMPAIGN_QUERY]` — точный GAQL для campaign-level, те же даты.

2. **Сырой ответ**
   - `[GOOGLE_SYNC_ACCOUNT_RAW]` — `raw_row_count`, `first_row_top_level_keys`, `sample_first_row` (segments_date, metrics_keys). Если `raw_row_count > 0` но `metrics_rows_length = 0`, строки отфильтрованы (например, нет `segments.date`).
   - `[GOOGLE_SYNC_ACCOUNT_MAPPED]` — `metrics_rows_length`, пример дат.
   - `[GOOGLE_SYNC_CAMPAIGN_RAW]` — `campaign_raw_row_count`, `first_row_top_level_keys`, sample по первой строке.
   - `[GOOGLE_SYNC_CAMPAIGN_NO_IDS]` — если API вернул строки, но ни у одной нет `campaign.id` (неверная структура ответа).
   - `[GOOGLE_SYNC_CAMPAIGN_AFTER_UPSERT]` — `campaign_list_length`, `external_to_campaign_id_size` (сколько кампаний нашли в БД после upsert).
   - `[GOOGLE_SYNC_CAMPAIGN_MAPPED]` — `camp_metrics_rows_length`, `campaign_raw_rows`, `drop_reason` если сырых строк есть, а маппированных нет.

3. **Zero-fill**
   - `[GOOGLE_SYNC_ZERO_FILL]` — `all_dates_count`, `dates_from_api_count`, `existing_dates_count`, `zero_dates_to_insert`.

4. **Парсинг метрик**
   - Поддержка и camelCase (`costMicros`), и snake_case (`cost_micros`) в ответе API для `metrics` (account и campaign).

Как интерпретировать:
- `raw_row_count = 0` и `campaign_raw_row_count = 0` → API не вернул данных за период (пустой аккаунт/даты).
- `raw_row_count > 0`, `metrics_rows_length = 0` → проверять `first_row_top_level_keys` и `segments_date`: возможно, другое имя поля (например, `segment` вместо `segments`).
- `campaign_raw_row_count > 0`, `camp_metrics_rows_length = 0` → смотреть `drop_reason` и `external_to_campaign_id_size`: если 0 — upsert кампаний не записал/не нашёл строки в БД (constraint/select).

---

## Проблема

Для `sources=google,direct,organic_search,referral` и диапазона 2026-02-01 → 2026-03-15:
- `rowCount = 2`, `pointsCount = 2`, `spend = 1.579773`
- Ожидалось: полное покрытие диапазона (как у Meta).

Дашборд читает только **campaign-level** строки (view `daily_ad_metrics_campaign`, `campaign_id IS NOT NULL`). Поэтому:
- Если Google sync пишет только **account-level** (и zero-fill), в дашборде по Google будет 0 строк.
- Две строки означают, что когда-то записались только 2 campaign-level строки (например, после падения sync на шаге campaigns upsert).

## Что проверено и исправлено

### 1. Contract campaigns upsert ↔ схема БД

- **Миграция** `supabase/migrations/20250602000000_campaigns_ensure_ad_accounts_id.sql`:
  - Добавляет `campaigns.ad_accounts_id` при необходимости.
  - Создаёт **не частичный** UNIQUE: `campaigns_ad_accounts_external_campaign_key (ad_accounts_id, external_campaign_id)`.
- Раньше был только частичный unique index `WHERE external_campaign_id IS NOT NULL`; PostgREST для `ON CONFLICT (ad_accounts_id, external_campaign_id)` требует именно constraint, не partial index — из-за этого возникала ошибка "no unique or exclusion constraint matching the ON CONFLICT specification".
- **Действие:** убедиться, что миграция применена к БД (`supabase db push` или развернуть миграции вручную).

### 2. Выполняется ли historical sync полностью

- Раньше при ошибке **campaigns upsert** sync возвращал 500 и не сохранял даже уже записанные account-level и zero-fill в ответе (хотя в БД они могли быть).
- **Правка:** блок campaign-level сделан **нефатальным**:
  - При ошибке `campaigns.upsert` — логируем `[GOOGLE_SYNC_CAMPAIGNS_UPSERT_NON_FATAL]`, не возвращаем 500, sync завершается 200.
  - При ошибке delete/insert campaign-level в `daily_ad_metrics` — аналогично, только лог, без 500.
- В результате account-level + zero-fill всегда сохраняются; при падении только campaign-блока в логах будет видно, что `campaign_rows_written = 0`.

### 3. Логирование для диагностики

В `app/api/oauth/google/insights/sync/route.ts` добавлено:

- После zero-fill: `[GOOGLE_INSIGHTS_SYNC]` с полями:
  - `account_rows_from_api`, `zero_days_inserted`, `total_account_level`, `period`, `ad_account_id`.
- В конце успешного sync: `[GOOGLE_INSIGHTS_SYNC_RESULT]` с полями:
  - `account_rows_from_api`, `zero_days_inserted`, `campaign_rows_written`, `total_rows`, `period`, `ad_account_id`.
- В ответе API: добавлены `zero_days_inserted` и пересчитан `saved` как `account_rows + zero_days_inserted + campaign_rows`.

По логам можно проверить:
- сколько строк пришло с API по аккаунту;
- сколько zero-fill дней записано;
- записались ли campaign-level строки.

### 4. Запись campaign-level в daily_ad_metrics

- Логика без изменений: после успешного campaigns upsert делается select по `ad_accounts_id` + `platform=google` + `external_campaign_id`, строится `campMetricsRows`, delete по диапазону дат + insert.
- Если upsert падал из-за отсутствия constraint, до этого шага sync не доходил. После применения миграции и повторного запуска sync campaign-level строки должны начать записываться (при наличии данных в Google Ads API).

### 5. Обрезание записи после account-level

- Раньше при ошибке в campaign-блоке весь sync возвращал 500, хотя account-level и zero-fill уже были в БД.
- Теперь ошибки в campaign-блоке не обрывают sync; ответ 200, в БД остаются account-level и zero-fill.

## Что сделать вам

1. **Применить миграцию** (если ещё не применена):
   ```bash
   npx supabase db push
   # или через Supabase Dashboard → SQL: выполнить 20250602000000_campaigns_ensure_ad_accounts_id.sql
   ```
2. **Запустить Google historical sync** за 2026-02-01 → 2026-02-28 (или 2026-03-15).
3. **Проверить логи** сервера:
   - `[GOOGLE_INSIGHTS_SYNC]` — zero-fill;
   - `[GOOGLE_INSIGHTS_SYNC_RESULT]` — итог: `account_rows_from_api`, `zero_days_inserted`, `campaign_rows_written`, `total_rows`.
4. **Проверить дашборд:** для `sources=google,...` ожидаются `pointsCount > 2`, `rowCount` заметно больше 2, spend не 1.579773 (если API отдаёт данные по кампаниям).

## Важно про дашборд

Дашборд использует **только campaign-level** (`daily_ad_metrics_campaign`). Поэтому:

- Если по Google в API за выбранный период **нет данных по кампаниям** (например, счета/кампании неактивны), campaign-level строк будет мало или 0, даже при полном account-level + zero-fill.
- Чтобы в дашборде по Google отображалось полное покрытие по датам при отсутствии campaign-level, нужно либо:
  - расширить источник данных дашборда (включать account-level для выбранного source), либо
  - оставить текущую логику и считать успехом полный account-level + zero-fill и запись campaign-level, когда API их отдаёт.

## Acceptance criteria (напоминание)

1. Google historical sync за 2026-02-01 → 2026-02-28 выполняется без ошибок (200).
2. В `daily_ad_metrics` по Google есть строки на весь диапазон (как минимум account-level + zero-fill; campaign-level — по данным API).
3. Для `sources=google,direct,organic_search,referral`: `pointsCount` > 2, `rowCount` существенно больше 2, spend не застрял на 1.579773 (при наличии данных в API).
4. Общий mixed/all и source-specific дашборды остаются консистентными (без рефакторинга широкой логики).
