# Sync layer — отчёт по внедрению

## 1. Критерий «аккаунт участвует в sync»

**Единый контракт:** участвуют только аккаунты с `ad_account_settings.is_enabled = true` для данного `project_id`.

- **Sync** (`POST /api/dashboard/sync`): выбирает все ad_accounts, у которых есть запись в ad_account_settings с project_id и is_enabled = true; для каждого такого аккаунта (Meta и Google) вызывается platform-specific insights/sync.
- **Dashboard / canonical** (`resolveAdAccountIds` в `dashboardCanonical.ts`): тот же источник — сначала выборка из ad_account_settings по project_id и is_enabled = true, затем ad_accounts по этим id, затем фильтр по sources (platform) и accountIds.
- **Backfill**: использует тот же набор — `getEnabledAdAccountIds(admin, projectId)` по ad_account_settings.

Расхождений между «кого синкаем» и «кого показываем в отчётах» нет.

---

## 2. Как теперь работает Meta sync

- Раньше: брался первый ad_account по integration_id (limit(1)), без учёта is_enabled.
- Сейчас: в `POST /api/dashboard/sync` сначала получаем все включённые аккаунты (ad_account_settings.is_enabled = true), затем фильтруем по provider = "meta" и для каждого такого аккаунта вызываем `GET /api/oauth/meta/insights/sync` с его external_account_id. Если включённых Meta-аккаунтов нет, Meta sync не запускается.

---

## 3. Как работает async backfill

- **Раньше:** `ensureBackfill` проверял покрытие по платформам (Meta/Google), при необходимости вызывал `fetch(/api/dashboard/sync)` и **ожидал** его завершения (`await promise`), из-за чего GET summary/timeseries мог долго висеть.
- **Сейчас:**
  - В `ensureBackfill` по проекту берутся только **enabled** ad_accounts (`getEnabledAdAccountIds`).
  - Проверяется покрытие диапазона campaign-level строками для этих аккаунтов (`isRangeCovered`).
  - Проверяется TTL: берётся последний `sync_runs.finished_at` по этим аккаунтам; если он есть и новее, чем TTL для диапазона (15 мин / 1 ч / 6 ч / 24 ч), backfill не запускается.
  - Если покрытия нет или данные устарели — формируется URL `/api/dashboard/sync`, создаётся Promise с `fetch(syncUrl)` **без await**, он кладётся в `syncPromises` по ключу `projectId:start:end`, функция сразу возвращает `true`. Запрос GET не ждёт завершения sync.
  - Дедуп: если для того же ключа уже есть запущенный sync, новый не стартует, возвращается `true`.

Итог: открытие дашборда не блокируется синком; синк при необходимости стартует в фоне.

---

## 4. Как реализован TTL

- Файл: `app/lib/syncTtl.ts`.
- `getSyncTtlMs(start, end)` по конечной дате диапазона возвращает:
  - end >= сегодня → 15 мин;
  - end >= сегодня − 7 дней → 1 ч;
  - end >= сегодня − 30 дней → 6 ч;
  - иначе → 24 ч.
- В `ensureBackfill` после проверки покрытия запрашивается последний `sync_runs.finished_at` по включённым аккаунтам проекта; если он есть и `now - lastSyncAt < getSyncTtlMs(start, end)`, sync не запускается.

---

## 5. Как реализован lock

- Файл: `app/lib/syncLock.ts`.
- Ключ: `platform:ad_account_id:date_start:date_end:sync_type` (например `google:1234567890:2026-03-01:2026-03-07:insights`).
- `withSyncLock(platform, adAccountId, dateStart, dateEnd, syncType, fn)`:
  - если по ключу уже есть Promise в Map — возвращается тот же Promise (второй запрос ждёт результат первого);
  - иначе создаётся Promise от `fn()`, сохраняется в Map, по завершении (finally) ключ удаляется.
- **Meta** (`app/api/oauth/meta/insights/sync/route.ts`): после вычисления since/until вызов обёрнут в `withSyncLock("meta", adAccountId, since, until, "insights", async () => { ... })`.
- **Google** (`app/api/oauth/google/insights/sync/route.ts`): после проверки since/until вызов обёрнут в `withSyncLock("google", externalAccountId, since, until, "insights", async () => { ... })`.

Параллельный синк одного и того же ad_account и диапазона не выполняется дважды; второй запрос получает результат первого.

---

## 6. Что исправлено в Google campaigns

- Раньше: в `campaigns` писался `ad_account_id: externalAccountId` (строка, внешний customer id), onConflict задавался как `"ad_account_id,external_campaign_id"`, при этом в миграциях уникальный индекс — по `(ad_accounts_id, external_campaign_id)`.
- Сейчас:
  - В upsert передаётся `ad_accounts_id: canonicalAdAccountId` (uuid из ad_accounts.id) и `external_campaign_id`, `name`, `platform`; onConflict — `"ad_accounts_id,external_campaign_id"`.
  - Выборка кампаний для маппинга в daily_ad_metrics делается по `ad_accounts_id = canonicalAdAccountId`.

Код и схема приведены к одному контракту: один уникальный индекс и одна и та же связь с ad_accounts по uuid.

---

## 7. Ограничения / дальнейшие улучшения

- **Account-level vs campaign-level:** дашборд по-прежнему читает только campaign-level (view `daily_ad_metrics_campaign`). Если за диапазон есть только account-level и нет campaign-level, дашборд покажет 0. Поведение задокументировано в комментариях в `dashboardCanonical.ts`. При желании можно добавить явный empty/incomplete state в UI или fallback на агрегат по account-level.
- **Lock in-memory:** блокировка хранится в процессе; при нескольких инстансах приложения возможен параллельный sync одного и того же аккаунта/диапазона на разных инстансах. Для мультиинстансной среды нужен внешний lock (Redis и т.п.).
- **Status / health:** разделение «OAuth valid» / «last sync ok» / «data freshness» в API и UI не делалось; при необходимости можно добавить отдельные поля в status endpoint.
- **TikTok:** интеграция не подключалась; все изменения (unified integrations, enabled-only, backfill по enabled, lock, TTL) сделаны так, чтобы TikTok можно было добавить без смены архитектуры.

---

## Checklist (acceptance criteria)

- [x] Meta больше не синкает только один аккаунт — синкаются все включённые Meta-аккаунты.
- [x] Синкаются только выбранные (enabled) аккаунты.
- [x] Dashboard и canonical layer используют тот же набор enabled accounts (resolveAdAccountIds по ad_account_settings.is_enabled).
- [x] GET dashboard endpoints не ждут sync (backfill запускает fetch без await).
- [x] Sync запускается только при отсутствии покрытия или при устаревших данных (TTL).
- [x] Sync не дублируется параллельно по одному ad_account/range (withSyncLock в Meta и Google insights/sync).
- [x] Google campaigns приведены к консистентности (ad_accounts_id + onConflict ad_accounts_id,external_campaign_id).
- [x] Архитектура готова к TikTok (unified integrations lookup, enabled-only, tiktok в platform list где нужно).
