# Historical backfill execution — аудит по enabled ad accounts

**Цель:** выяснить, почему при historical backfill banner на dashboard в Accounts у Meta "Data through 15.03", а у Google "Data through 02.03" (разное покрытие по аккаунтам).

---

## 1. Какие sync_runs создаются при выборе длинного диапазона

### Источник вызова

- **dashboard/sync** (`app/api/dashboard/sync/route.ts`) вызывается из `ensureBackfill` с параметрами `(project_id, start, end)` для каждого **missing interval** (например, 01.02–09.03).
- Для одного интервала один POST `/api/dashboard/sync?project_id=...&start=...&end=...`.

### Кто пишет в sync_runs

Каждый platform-specific sync (Meta, Google) сам создаёт и обновляет строку в `sync_runs`:

| Поле | Meta (`meta/insights/sync`) | Google (`google/insights/sync`) |
|------|----------------------------|---------------------------------|
| **platform** | `"meta"` | `"google"` |
| **ad_account_id** | `canonicalAdAccountId` (ad_accounts.id по integration + external id) | `canonicalAdAccountId` (ad_accounts.id по integration + external_account_id) |
| **sync_type** | `"insights"` | `"insights"` |
| **status** | `"running"` → затем `"ok"` или `"error"` | то же |
| **started_at** | default now() при insert | то же |
| **finished_at** | при updateSyncRun (ok/error) | то же |
| **rows_written** | при успехе | при успехе |
| **error_message** | при ошибке | при ошибке |
| **meta** | при ошибке: `{ period: { since, until }, ... }`; при успехе: `{ period: { since, until }, ... }` и счётчики | при ошибке: `{ period: { since, until }, ... }`; при успехе: `{ since, until, account_rows_written, campaign_rows_written, campaigns_seen, ad_account_id_external }` |

Схема таблицы: `supabase/migrations/20250307300000_sync_runs.sql`. Отдельного поля "range" нет; диапазон только в **meta** (since/until).

Итого: для одного вызова dashboard/sync по одному интервалу создаётся **по одной записи sync_runs на каждый включённый аккаунт** (каждый Meta-аккаунт и каждый Google-аккаунт), так как sync вызывается в цикле по `metaAccounts` и `googleAccounts` с одним и тем же `start`/`end`.

---

## 2. Запускается ли historical sync по каждому enabled account и по какому диапазону

### Логика dashboard/sync

**Файл:** `app/api/dashboard/sync/route.ts`

1. Берутся **enabled** ad_accounts: `ad_account_settings` где `project_id` и `is_enabled = true` → список `ad_account_id` (это **ad_accounts.id**, UUID).
2. По этим id выбираются строки из **ad_accounts**: `id, external_account_id, provider`.
3. Фильтр по платформе: `provider === "meta"` → `metaAccounts`, `provider === "google"` → `googleAccounts`.

Важно: если в `ad_accounts` у Google-аккаунтов поле называется `platform` и не продублировано в `provider`, то `provider` может быть `null`/undefined, и такие аккаунты **не попадут** в `googleAccounts` и для них sync **не запустится**. В миграциях есть приведение `provider` из `platform` (`20250307000003_repair_ad_accounts_provider_external.sql`).

4. Для **каждого** элемента `metaAccounts`: GET `/api/oauth/meta/insights/sync?project_id=&ad_account_id=<external>&date_start=<start>&date_stop=<end>`.
5. Для **каждого** элемента `googleAccounts`: GET `/api/oauth/google/insights/sync?project_id=&ad_account_id=<external>&date_start=<start>&date_end=<end>`.

Вывод: для одного вызова dashboard/sync **один и тот же диапазон (start, end)** передаётся во **все** включённые Meta- и Google-аккаунты. По коду **исторический sync по missing interval запускается для каждого enabled account** с одним и тем же range.

---

## 3. Откуда на Accounts page берутся "Data through" и "Last sync"

### API

**Файл:** `app/api/dashboard/accounts/route.ts`

- Список аккаунтов: из `integrations` по `project_id` → `ad_accounts` по `integration_id` (id, account_name, external_account_id, provider).
- **Покрытие (coverage):** один запрос к `daily_ad_metrics`: все строки за последние 2 года по `ad_account_id in (ids)`, поля `ad_account_id`, `date`. По ним считается:
  - **min_date, max_date, row_count** по каждому `ad_account_id`.
- **Last sync:** запрос к `sync_runs`: `project_id`, `sync_type = 'insights'`, `ad_account_id in (ids)`, сортировка по `started_at DESC`, limit 500. Для каждого `ad_account_id` берётся **первая** запись (самая новая) → **last_sync_at** = `started_at`, **last_sync_status** = `status`.

В ответе для каждого аккаунта: `min_date`, `max_date`, `row_count`, `last_sync_at`, `last_sync_status`.

### Frontend

**Файл:** `app/app/(with-sidebar)/accounts/AccountsPageClient.tsx`

- **"Data through ДД.ММ.ГГГГ"** — из `formatDataThrough(a.max_date)`, т.е. **максимальная дата по данным в daily_ad_metrics** для этого аккаунта (стр. 213–219).
- **"Last sync: ok/error — ДД.ММ.ГГГГ ЧЧ:ММ"** — из `formatLastSync(a.last_sync_at, a.last_sync_status)`, т.е. **последний запуск sync по sync_runs** для этого аккаунта (стр. 221–235, использование ~1189).

Итого: **Data through** = реальное покрытие данных (max date в `daily_ad_metrics`). **Last sync** = последний факт запуска sync по `sync_runs`. Они не обязаны совпадать по дате (последний sync мог быть по другому диапазону или с ошибкой).

---

## 4. Совпадение с тем, что пишут sync и sync_runs

- **daily_ad_metrics:** Meta и Google пишут по `ad_account_id` = canonical UUID. Accounts использует тот же `ad_accounts.id` для списка и для coverageMap по `daily_ad_metrics` → **источник один и тот же**, "Data through" отражает реально записанные данные.
- **sync_runs:** и Meta, и Google при insert передают `ad_account_id: canonicalAdAccountId` (ad_accounts.id). В dashboard/accounts lastSyncMap строится по `sync_runs.ad_account_id` в том же наборе id. **Идентификаторы согласованы.**

Расхождение возможно только если:
- для части аккаунтов sync не вызывается (например, не попали в `googleAccounts` из‑за `provider`),
- или sync вызывается, но падает с ошибкой / не пишет строки (API вернул пусто),
- или запись в sync_runs делается с другим `ad_account_id` (по коду такого нет).

---

## 5. Может ли быть: banner "historical backfill started", но Google не получает sync по missing interval

### Когда показывается banner

Banner показывается, когда в ответе summary или timeseries есть `backfill.historical_sync_started === true` или `backfill.range_partially_covered === true`. Это происходит, когда **ensureBackfill** обнаруживает **missing intervals** и запускает для них dashboard/sync.

### Как считается "покрыт ли диапазон"

**Файл:** `app/lib/dashboardBackfill.ts` — `isRangeCovered`

- Берутся **все** enabled ad_account_ids.
- Запрос к `daily_ad_metrics`: даты, где `ad_account_id in (ids)`, `campaign_id is not null`, `date between start and end`.
- По всем строкам собирается **один общий** набор дат (union по всем аккаунтам).
- **covered = true** только если **каждый день** в [start, end] присутствует в этом наборе.

То есть покрытие считается **агрегатно по всем включённым аккаунтам**: если хотя бы один аккаунт имеет данные за какой-то день, этот день считается покрытым. Поэтому:

- Если у Meta есть данные 01.02–15.03, а у Google только 01.02–02.03, то по текущей логике диапазон 01.02–15.03 может быть объявлен **покрытым**, и **historical backfill для этого диапазона не запустится** — в том числе для Google.
- Banner при этом может быть виден в другом сценарии: когда **ни у кого** нет полного покрытия (например, у всех только 10.03–15.03). Тогда missing interval 01.02–09.03 считается одним для всех, и **один и тот же** вызов dashboard/sync с (01.02, 09.03) идёт и в Meta, и в Google.

Вывод: если banner виден, то по коду dashboard/sync **вызывается с одним и тем же интервалом для всех enabled accounts**, в том числе для Google. Ситуация "banner есть, но Google вообще не получает sync по missing interval" возможна только если:

- Google-аккаунты **не входят** в список при вызове dashboard/sync (например, не попали в `googleAccounts` из‑за пустого/неверного `provider` в `ad_accounts`), или
- вызов до Google не доходит (ошибка до цикла по Google, обрыв, таймаут и т.п.).

---

## 6. Итоги и ответы на вопросы

### Запускается ли sync по каждому enabled account?

**Да.** dashboard/sync в цикле вызывает insights/sync для каждого элемента `metaAccounts` и каждого элемента `googleAccounts` с **одними и теми же** start/end. Один missing interval → один общий диапазон для всех.

### Какой именно account может не догружаться?

- Тот, который **не попал** в `metaAccounts` или `googleAccounts`: проверка — в `ad_accounts` у него должен быть заполнен **provider** (`meta` / `google`). Если там только `platform` и в коде читается `provider`, часть аккаунтов может отфильтроваться.
- Тот, для которого sync **упал** (ошибка в sync_runs, без записей в daily_ad_metrics).
- Тот, для которого sync **успешен**, но Google/Meta API **вернул пустой набор** за этот период (нет трафика/кампаний) — тогда "Data through" не сдвинется, хотя "Last sync" обновится.

### Почему Google может отставать от Meta?

1. **Ошибки при sync по Google** (токен, лимиты API, сеть) — в sync_runs по этому ad_account_id будут status=error и при необходимости error_message/meta.
2. **Пустой ответ Google Ads API** за missing interval (нет данных за 01.02–09.03) — строк в daily_ad_metrics не прибавится, max_date останется 02.03.
3. **Google не попадает в цикл** — если в `ad_accounts` у Google-аккаунтов нет или не тот `provider`, они не попадут в `googleAccounts` и для них sync по этому интервалу не вызовется.

### Это backend bug, status bug или data coverage bug?

- **Не баг отображения статуса:** "Data through" и "Last sync" на Accounts считаются из тех же данных (daily_ad_metrics и sync_runs), которые пишут sync’и; логика отображения корректна.
- **Возможный backend/design:**  
  - **Агрегатное покрытие:** решение "covered = union по всем аккаунтам" приводит к тому, что при сильном отставании одного аккаунта (например, Google) historical backfill для него может **вообще не запускаться**, если другой аккаунт (Meta) уже закрывает весь диапазон. Тогда это **логика покрытия/backfill**, а не баг выполнения sync.  
  - **Проверка provider:** если в части окружений/миграций у Google в `ad_accounts` не заполнен `provider`, то это **backend bug** (не все аккаунты попадают в sync).
- **Data coverage:** если sync для Google реально вызывается и завершается ok, но Google Ads за этот период не отдаёт данных — разница Meta 15.03 vs Google 02.03 будет **разницей в наличии данных в источнике**, а не багом нашего кода.

---

## 7. Рекомендации по проверке

1. **Проверить sync_runs после выбора длинного диапазона:**
   - по `project_id`, `sync_type = 'insights'`, `started_at` за последние часы;
   - смотреть: platform, ad_account_id, status, started_at, finished_at, rows_written, error_message, meta (в meta — since/until).
   - Убедиться, что для каждого enabled ad_account_id есть запись с тем же интервалом (since/until), что и missing interval.

2. **Проверить ad_accounts:**
   - для всех включённых через ad_account_settings записей наличие непустого `provider` (`meta` / `google`).

3. **При отставании Google:**
   - по ad_account_id Google посмотреть последние sync_runs: status, error_message, meta;
   - если status=ok и rows_written=0 — трактовать как "API не вернул данных за этот диапазон";
   - если status=error — разбирать error_message и meta.

4. **При необходимости per-account coverage:**
   - рассмотреть переход от "covered = union по всем аккаунтам" к "covered = для каждого enabled аккаунта свой набор дат", и запуск missing intervals **по аккаунту**, а не один общий интервал для всех. Это уже изменение дизайна backfill
