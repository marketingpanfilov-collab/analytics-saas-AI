# Google campaign-level sync — аудит и диагностика

## Root cause (почему только 2 campaign-level строки)

Canonical dashboard считает только **campaign-level** строки (`daily_ad_metrics_campaign`). По Google за 2026-02-01 → 2026-03-15 в БД есть **43 account-level** строки (API + zero-fill), но только **2 campaign-level**. Причины могут быть комбинацией:

1. **Google Ads API по campaign-запросу возвращает мало строк** — за период реально отдаётся только 2 даты/кампании (или 0), тогда campaign-level запись корректна, но данных мало.
2. **Структура ответа API** — поле `campaign.id` может отсутствовать, а id передаваться в `campaign.resourceName` (например `customers/123/campaigns/456`). Раньше использовался только `r.campaign?.id`, строки без `id` отбрасывались.
3. **Campaigns upsert падает** — при ошибке `ON CONFLICT (ad_accounts_id, external_campaign_id)` (нет constraint в БД) select после upsert возвращает пустой список → `externalToCampaignId.size === 0` → все campaign-строки отфильтровываются перед insert в `daily_ad_metrics`.
4. **Маппинг режет строки** — фильтр `externalToCampaignId.has(String(r.campaign.id))` отбрасывает строки, если id в API в другом формате или не совпадает с ключами в БД.

## Что именно Google sync не записывал

- **Campaign-level строки в `daily_ad_metrics`** за диапазон 2026-02-01 → 2026-03-15: ожидалось покрытие по всем дням, где API отдаёт кампании; фактически записывались только 2 строки (2 даты или 2 комбинации campaign+date).
- Account-level и zero-fill записываются (43 строки), поэтому `[CANONICAL_SOURCE_LEVELS]` показывает `account_level_rows_in_range: 43`, `campaign_level_rows: 2`.

## Изменённые файлы

- **`app/api/oauth/google/insights/sync/route.ts`**
  - Введена функция **`getCampaignExternalId(r)`**: берёт `campaign.id`; если его нет — парсит id из `campaign.resourceName` (формат `.../campaigns/456` → `456`). Тип `CampaignRow` расширен полем `campaign.resourceName`.
  - Везде, где раньше использовался `r.campaign?.id`, используется **`getCampaignExternalId(r)`** (построение `campaignIdToName`, фильтр и маппинг `campMetricsRows`).
  - **Диагностические логи:**
    - **`[GOOGLE_SYNC_CAMPAIGN_RAW]`**: `campaign_raw_row_count`, `unique_campaign_ids_from_api`, `unique_dates_from_api`, `first_row_top_level_keys`, `sample_first` (в т.ч. `campaign_id` через getCampaignExternalId, `campaign_resourceName`).
    - **`[GOOGLE_SYNC_CAMPAIGN_AFTER_UPSERT]`**: `campaign_list_length`, `external_to_campaign_id_size`, `requested_external_ids`, **`rows_with_campaign_id`**, **`rows_with_date`**, **`rows_with_both`**, **`rows_in_external_map`**, **`drop_reason_after_upsert`** (no_campaigns_in_db_after_upsert / api_campaign_ids_not_in_db_check_external_campaign_id_match).
    - **`[GOOGLE_SYNC_CAMPAIGN_MAPPED]`**: `camp_metrics_rows_length`, `campaign_raw_rows`, **`unique_campaign_ids_mapped`**, **`unique_dates_mapped`**, **`rows_prepared_for_insert`**, `drop_reason`.
    - **`[GOOGLE_SYNC_CAMPAIGN_INSERT_OK]`** (при успешном insert): `rows_prepared`, `rows_actually_inserted`, `unique_dates`, `unique_campaign_ids`, `period`.
    - **`[GOOGLE_INSIGHTS_SYNC_RESULT]`**: добавлены `campaigns_seen_from_api` и **`note`** при `campaignsSeen > 0 && campaign_rows_written === 0` с указанием смотреть drop_reason и campaigns upsert.

## Подтверждающие логи до/после

### До (типичная картина при только 2 campaign-level)

- `[GOOGLE_SYNC_CAMPAIGN_RAW]` — без разбивки по unique_campaign_ids / unique_dates; без явного drop_reason.
- `[GOOGLE_SYNC_CAMPAIGN_AFTER_UPSERT]` — только campaign_list_length и external_to_campaign_id_size; непонятно, сколько строк отброшено и на каком шаге.
- `[GOOGLE_INSIGHTS_SYNC_RESULT]` — campaign_rows_written: 2, без указания, что API вернул больше кампаний, но записано меньше.

### После (как читать логи)

1. **`[GOOGLE_SYNC_CAMPAIGN_RAW]`**  
   - `campaign_raw_row_count` — сколько строк вернул API.  
   - `unique_campaign_ids_from_api` / `unique_dates_from_api` — сколько уникальных кампаний и дат в сыром ответе.  
   - Если `campaign_raw_row_count` большой, а раньше записывалось 2 — смотреть дальше.

2. **`[GOOGLE_SYNC_CAMPAIGN_AFTER_UPSERT]`**  
   - `external_to_campaign_id_size` — сколько кампаний нашлось в БД после upsert.  
   - `rows_in_external_map` — сколько сырых строк имеют campaign_id, попавший в этот маппинг.  
   - **`drop_reason_after_upsert`**:  
     - `no_campaigns_in_db_after_upsert` — upsert кампаний не записал/не вернул строк (constraint, ошибка).  
     - `api_campaign_ids_not_in_db_check_external_campaign_id_match` — в API есть id, но они не совпали с БД (формат, регистр, другой scope).

3. **`[GOOGLE_SYNC_CAMPAIGN_MAPPED]`**  
   - `rows_prepared_for_insert` — сколько строк передано в insert.  
   - Если `campaign_raw_row_count` > 0, а `rows_prepared_for_insert` === 0 — все строки отброшены фильтром (нет id/date или нет в externalToCampaignId).

4. **`[GOOGLE_SYNC_CAMPAIGN_INSERT_OK]`**  
   - Появляется только при успешном insert.  
   - `rows_actually_inserted` должен совпадать с `rows_prepared_for_insert`.

5. **`[GOOGLE_INSIGHTS_SYNC_RESULT]`**  
   - При `campaigns_seen_from_api` > 0 и `campaign_rows_written` === 0 в **`note`** указано смотреть drop_reason и campaigns upsert.

## SQL verification (проверка БД после sync)

Подставьте вместо `GOOGLE_AD_ACCOUNT_UUID` реальный `ad_accounts.id` (UUID) для Google-аккаунта (из логов `canonical_ad_account_id` или из `ad_accounts` по `provider = 'google'`).

```sql
-- Campaign-level по Google ad_account_id (то, что видит canonical dashboard для sources=google)
SELECT
  COUNT(*) AS campaign_rows,
  COUNT(DISTINCT date) AS distinct_dates,
  MIN(date) AS min_date,
  MAX(date) AS max_date
FROM daily_ad_metrics
WHERE ad_account_id = 'GOOGLE_AD_ACCOUNT_UUID'
  AND campaign_id IS NOT NULL
  AND platform = 'google'
  AND date >= '2026-02-01' AND date <= '2026-03-15';

-- Account-level для сравнения (то же аккаунт, тот же диапазон)
SELECT
  COUNT(*) AS account_rows,
  COUNT(DISTINCT date) AS distinct_dates,
  MIN(date) AS min_date,
  MAX(date) AS max_date
FROM daily_ad_metrics
WHERE ad_account_id = 'GOOGLE_AD_ACCOUNT_UUID'
  AND campaign_id IS NULL
  AND platform = 'google'
  AND date >= '2026-02-01' AND date <= '2026-03-15';
```

**Ожидание после фикса:** при условии что API отдаёт campaign-level за весь диапазон, `campaign_rows` и `distinct_dates` по campaign-level должны быть того же порядка, что и по account-level (или соответствовать реальной отдаче API). До фикса типично: campaign_rows = 2, account_rows = 43.

## Итог

- **Root cause:** мало campaign-level строк из-за (1) малой отдачи API по campaign-запросу, (2) отсутствия поддержки id из `resourceName`, (3) падения/пустого результата campaigns upsert, (4) отсечения строк при маппинге.
- **Что не записывалось:** campaign-level строки в `daily_ad_metrics` на весь диапазон.
- **Изменения:** один файл — `app/api/oauth/google/insights/sync/route.ts` (getCampaignExternalId, расширенные логи, явные drop_reason и note).
- **Проверка:** перезапустить Google sync за 2026-02-01 → 2026-03-15 и по новым логам определить, на каком шаге теряются строки; при необходимости применить миграцию с UNIQUE по campaigns и убедиться, что API отдаёт campaign.id или resourceName; затем проверить БД запросами выше. После этого `sources=google,direct,organic_search,referral` должен показывать полноценный timeseries, а не 2 строки.
