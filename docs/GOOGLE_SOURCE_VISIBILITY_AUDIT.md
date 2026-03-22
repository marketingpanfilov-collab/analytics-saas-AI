# Google source visibility in canonical dashboard — аудит

## Цель

Понять, почему при `sources=google,direct,organic_search,referral` дашборд показывает только 2 строки и spend 1.579773, и добиться консистентного отображения Google вместе с all sources.

## 1. Откуда canonical берёт данные

- **Источник:** view `daily_ad_metrics_campaign` (только строки с `campaign_id IS NOT NULL`).
- **Фильтр по source:** в `dashboardCanonical.ts` вызывается `resolveAdAccountIds(projectId, sources)`, затем выборка из view по `ad_account_id IN (...)` и `platform IN ('meta','google','tiktok')`.
- **Вывод:** дашборд **никогда не показывает account-level** строки. Если по Google есть только account-level (или zero-fill), в summary/timeseries по `sources=google` попадут только **campaign-level** строки. Поэтому 2 строки = 2 campaign-level строки по Google в БД за выбранный диапазон.

## 2. Как попадают аккаунты в sources=google

- `resolveAdAccountIds`:
  - Берёт включённые аккаунты из `ad_account_settings` (is_enabled = true).
  - Дёргает `ad_accounts` по этим id, выбирает `id, provider, platform`.
  - При заданном `sources` фильтрует по **источнику**: `(provider ?? platform)` входит в нормализованный список (meta, google, tiktok, yandex).
- **Исправление:** добавлен fallback: если `provider` пустой, используется `platform`, чтобы Google-аккаунты с `platform='google'` не выпадали.
- **Диагностика:** при фильтре по source логируется `[CANONICAL_RESOLVE_SOURCES]` — projectId, sources, resolvedCount, кратко resolvedIds (id, provider, platform). Так можно убедиться, что для `sources=google` в выборку попадает нужный ad_account.

## 3. Есть ли campaign-level строки Google в БД

- По текущему поведению: для `sources=google` приходит **adAccountIdsCount = 1** и **rowCount = 2** → в `daily_ad_metrics_campaign` для этого Google ad_account_id за диапазон 2026-02-01 → 2026-03-15 есть ровно **2 строки** (две даты).
- **Вывод:** campaign-level строк по Google за этот диапазон почти нет; те 2 строки могли появиться от старого sync или от одного из запусков.

## 4. Почему Google sync не пишет больше campaign-level

- Либо **historical sync для Google за 2026-02-01 → 2026-03-15 не вызывается**, либо вызывается, но:
  - Google Ads API за этот период возвращает мало/ноль строк (account-level и campaign-level), или
  - Ошибка/обрез после account-level (например, падение campaigns upsert или маппинга) до записи campaign-level.
- **Backfill:** при запросе диапазона 2026-02-01–2026-03-15 считается покрытие по **всем** включённым аккаунтам (по любому уровню: campaign или account). Если у Meta много строк, а у Google только 2 campaign-level, «общих» покрытых дат мало → формируются missing intervals → вызывается `POST /api/dashboard/sync` с этими интервалами. Sync дёргает и Meta, и Google за один и тот же интервал. То есть **historical sync для Google по этим интервалам должен вызываться**.
- Чтобы проверить «вызывается ли и что возвращает API», смотреть логи Google sync: `[GOOGLE_SYNC_ACCOUNT_RAW]`, `[GOOGLE_SYNC_CAMPAIGN_RAW]`, `[GOOGLE_INSIGHTS_SYNC_RESULT]` (см. GOOGLE_HISTORICAL_SYNC_AUDIT.md).

## 5. Если строки в БД есть — подхват в sources=google

- Подхват идёт по `ad_account_id` и `platform`. В `daily_ad_metrics` для Google при записи выставляется `platform: 'google'`. View `daily_ad_metrics_campaign` не меняет колонки, в запросе стоит `.in("platform", ["meta", "google", "tiktok"])`, так что Google строки участвуют.
- **Ошибка в фильтрации по source** была бы только если бы `resolveAdAccountIds` для `sources=google` не возвращал id Google-аккаунта (например, из‑за пустого `provider` при отсутствии fallback). Добавлен fallback и лог `[CANONICAL_RESOLVE_SOURCES]` — по нему видно, что для google резолвится 1 аккаунт.

## 6. Google только в account-level

- Это как раз текущая ситуация: campaign-level по Google за диапазон почти нет (2 строки), а account-level (и zero-fill) canonical **намеренно не использует**, чтобы не дублировать агрегаты.
- **Диагностика:** при фильтре по source и малом числе строк (≤10) логируется `[CANONICAL_SOURCE_LEVELS]`: campaign_level_rows, account_level_rows_in_range. Если campaign_level_rows = 2, а account_level_rows_in_range большое (например, 43), значит по Google в БД в основном account-level, и дашборд их не показывает — это ожидаемое поведение текущей логики.

## Что сделано в коде

1. **dashboardCanonical.ts**
   - `resolveAdAccountIds`: запрос к `ad_accounts` с полями `id, provider, platform`; при фильтре по source сравнение по `(provider ?? platform)`.
   - Лог `[CANONICAL_RESOLVE_SOURCES]` при фильтре по source (resolvedCount, resolvedIds с provider/platform).
   - При source-filtered и rowCount ≤ 10 — лог `[CANONICAL_SOURCE_LEVELS]` с числом campaign-level и account-level строк в диапазоне и примечанием, если видно «только account-level».

## Рекомендации

1. **Проверить по логам при запросе с sources=google и диапазоном 2026-02-01–2026-03-15:**
   - `[CANONICAL_RESOLVE_SOURCES]`: resolvedCount = 1, у резолвленного аккаунта provider или platform = google.
   - `[CANONICAL_SOURCE_LEVELS]`: если account_level_rows_in_range >> campaign_level_rows — подтверждение, что Google в основном в account-level и дашборд их не показывает.

2. **Добить Google historical sync**, чтобы появлялись campaign-level строки:
   - Убедиться, что миграция с UNIQUE по `(ad_accounts_id, external_campaign_id)` применена (campaigns upsert не падает).
   - Запустить sync за 2026-02-01–2026-02-28 и 2026-03-01–2026-03-15 (или один общий диапазон) и по логам `[GOOGLE_SYNC_*]` проверить: есть ли сырые campaign rows из API, пишутся ли они в `daily_ad_metrics`.

3. **Acceptance criteria** (как в задаче):
   - Для `sources=google,direct,organic_search,referral`: rowCount и pointsCount существенно больше 2, spend больше 1.579773 — это выполнится, когда в БД по Google появятся campaign-level строки за весь диапазон (через успешный Google sync с данными из API).
