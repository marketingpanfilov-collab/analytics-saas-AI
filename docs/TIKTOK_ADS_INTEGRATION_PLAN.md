# TikTok Ads Integration — подготовительный аудит и implementation plan

Цель: подключить TikTok Ads в текущую архитектуру (integrations / ad_accounts / dashboard / attribution) без поломки существующей логики Meta и Google.

---

## Текущая архитектура интеграций (кратко)

| Сущность | Назначение |
|----------|------------|
| **integrations** | Одна запись на (project_id, platform). `platform` ∈ `meta`, `google`, `tiktok` (CHECK уже есть). |
| **integrations_auth** | Один ряд на integration: access_token, refresh_token, token_expires_at, scopes, meta. Общий слой для всех платформ. |
| **ad_accounts** | Рекламные аккаунты: integration_id, provider (= platform), external_account_id, account_name. `provider` ∈ meta, google, tiktok. |
| **ad_account_settings** | Состояние по аккаунту: is_enabled, selected_for_reporting, sync_enabled, last_sync_at, last_sync_status, last_sync_error. |
| **sync_runs** | Запуски синка: project_id, platform, ad_account_id, sync_type, status, started_at, finished_at, rows_written, error_message, meta. |
| **daily_ad_metrics** | Метрики по дням: ad_account_id, campaign_id (nullable), date, platform, spend, impressions, clicks, … |
| **campaigns** | Кампании: привязка к ad_accounts (ad_account_id / ad_accounts_id), external_campaign_id для не-Meta. |

**integration_entities** используется только в Google (иерархия MCC / customer). Для TikTok можно обойтись без неё или завести при необходимости (например, Business Center → Advertisers).

Схема уже предусматривает TikTok: в миграциях есть `platform IN ('meta', 'google', 'tiktok')`, в `traffic_source_platform_columns` — `tiktok` / `tiktok_ads`, в `trafficSourceDetection.ts` — ttclid → tiktok / tiktok_ads.

---

## Как сделаны Meta и Google (что переиспользовать)

### Meta
- OAuth: `/api/oauth/meta/start` (state = base64(JSON)), callback обменивает code → short-lived → long-lived, пишет в `integrations_meta` (legacy) и `integrations_auth`. Refresh_token в Meta не используется в коде (long-lived ~60 дней).
- Статус: `getMetaIntegrationForProject` → integrations + integrations_auth (+ fallback integrations_meta); valid = token есть и не истёк.
- Аккаунты: сохраняются в meta_ad_accounts + ad_accounts через callback; выбор в ad_account_settings.
- Синк: insights/sync по ad_account_id, пишет daily_ad_metrics (account + campaign), sync_runs.

### Google
- OAuth: `/api/oauth/google/start` (scope adwords, access_type=offline, prompt=consent), callback — code → token, **сохранение refresh_token** (с защитой от перезаписи null при повторном подключении).
- Токен: `getValidGoogleAccessToken(admin, integrationId)` — при истечении делает refresh через refresh_token, обновляет БД, возвращает access_token.
- Статус: `/api/oauth/google/integration/status` использует getValidGoogleAccessToken; valid = удалось получить токен.
- Аккаунты: POST `/api/oauth/google/accounts` — listAccessibleCustomers + иерархия, запись в integration_entities + ad_accounts, ad_account_settings.
- Синк: GET `/api/oauth/google/insights/sync` (project_id, ad_account_id, date_start, date_end) — Google Ads API, daily_ad_metrics + campaigns, sync_runs.

Переиспользовать для TikTok:
- **OAuth flow**: тот же паттерн — start (state = base64(JSON), project_id, return_to), callback обмен code → tokens, upsert integrations + integrations_auth; **обязательно сохранять refresh_token и не перезаписывать его null** при повторном подключении.
- **Token refresh helper**: по аналогии с `googleAdsAuth.ts` сделать `tiktokAdsAuth.ts` с getValidTikTokAccessToken (проверка expires, при истечении — POST refresh, обновление БД).
- **Ad account selection**: тот же слой ad_accounts + ad_account_settings; UI уже умеет показывать списки по platform.
- **Sync pattern**: один endpoint типа GET `/api/oauth/tiktok/insights/sync` с project_id, ad_account_id (external advertiser id), date_start, date_end; запись в daily_ad_metrics (platform='tiktok'), campaigns при необходимости, sync_runs.
- **Status endpoint**: GET `/api/oauth/tiktok/integration/status?project_id=...` — наличие integration + валидный токен (через getValidTikTokAccessToken).

---

# Раздел 1 — как должен выглядеть TikTok OAuth flow

1. **Start**  
   - `GET /api/oauth/tiktok/start?project_id=<uuid>&return_to=/app/accounts`  
   - Проверка project_id (UUID), наличие TIKTOK_CLIENT_KEY, TIKTOK_REDIRECT_URI.  
   - State = base64(JSON({ project_id, return_to, nonce, v: 1 })).  
   - Редирект на TikTok OAuth:  
     `https://www.tiktok.com/auth/authorize/` (или актуальный host из документации) с параметрами:  
     - client_key (TIKTOK_CLIENT_KEY)  
     - scope — см. раздел «Scopes» ниже  
     - response_type=code  
     - redirect_uri  
     - state  

2. **Callback**  
   - `GET /api/oauth/tiktok/callback?code=...&state=...`  
   - Проверка state, извлечение project_id, return_to.  
   - При error от TikTok — редирект на return_to с query connected=tiktok_error&reason=...  
   - Обмен code на токены: POST на TikTok token endpoint (например `https://open.tiktokapis.com/v2/oauth/token/`) с grant_type=authorization_code, code, client_key, client_secret, redirect_uri.  
   - В ответе: access_token, refresh_token (может отсутствовать при повторной авторизации), expires_in.  
   - Upsert integrations (project_id, platform='tiktok', status='active', name='TikTok Ads').  
   - **Перед upsert integrations_auth**: если в ответе refresh_token пустой — загрузить текущую строку integrations_auth по integration_id и подставить существующий refresh_token (как в Google), чтобы не затирать его.  
   - Upsert integrations_auth: access_token, refresh_token (сохранённый или новый), token_expires_at, scopes, meta (source: tiktok_oauth_callback).  
   - Редирект на return_to с connected=tiktok.

3. **Scopes (TikTok)**  
   По документации TikTok Marketing API типичные scopes для чтения рекламы:  
   - `user.info.basic` — базовый профиль  
   - `advertiser.list` или эквивалент — список рекламных аккаунтов  
   - Чтение кампаний/объявлений/отчётов (уточнить актуальные имена в официальной документации, например `report.insight`, `campaign.read` и т.п.).  
   Итоговый список зафиксировать в коде и в отчёте после проверки портала TikTok for Developers.

---

# Раздел 2 — какие таблицы БД уже подходят

- **integrations** — подходит. Одна запись (project_id, platform='tiktok'). Дополнительно при желании можно использовать поля name, status, integration_type, если они уже есть в более поздних миграциях.  
- **integrations_auth** — подходит. Один ряд на integration: access_token, refresh_token, token_expires_at (TikTok access ~24h), scopes, meta.  
- **ad_accounts** — подходит. provider='tiktok', external_account_id = TikTok advertiser id (строка), account_name. Нужен owner_id (как у Google) — из projects.owner_id.  
- **ad_account_settings** — подходит. Включение/выбор аккаунтов для отчётов и синка.  
- **sync_runs** — подходит. platform='tiktok', sync_type='insights', ad_account_id = ad_accounts.id.  
- **daily_ad_metrics** — подходит. platform='tiktok', те же поля (spend, impressions, clicks, …).  
- **campaigns** — подходит. Связь с ad_accounts (ad_account_id / external_account_id), external_campaign_id для TikTok campaign id.

Никаких новых таблиц для базового OAuth + список рекламных аккаунтов + синк spend/campaigns не требуется.

---

# Раздел 3 — какие новые поля / статусы могут понадобиться

- **integrations**: при необходимости можно добавить name, status, integration_type (если ещё не добавлены миграциями) — для единообразия с Meta/Google.  
- **integrations_auth**: текущих полей достаточно. В meta можно хранить advertiser_ids из ответа TikTok при первом логине (если API отдаёт их в token response).  
- **ad_accounts**: уже есть provider, external_account_id, account_name. Для TikTok external_account_id = advertiser id (числовой строка).  
- **sync_runs**: без изменений.  
- **Статусы в UI**: те же, что у Google — valid/invalid на основе наличия интеграции и валидного access_token (после возможного refresh). Отдельно можно ввести reason (token_expired / oauth_revoked / no_integration) для будущего улучшения UX.

Новых полей в основных таблицах не требуется; опционально — расширение meta в integrations_auth под TikTok-специфичные данные.

---

# Раздел 4 — как делать token refresh устойчиво

- **Жизненный цикл TikTok**: access_token обычно ~24 часа, refresh_token — до 365 дней. Обновление: POST на `https://open.tiktokapis.com/v2/oauth/token/` с grant_type=refresh_token, refresh_token, client_key, client_secret.  
- **Паттерн**: по аналогии с `app/lib/googleAdsAuth.ts` реализовать `app/lib/tiktokAdsAuth.ts`:  
  - getValidTikTokAccessToken(admin, integrationId):  
    - Читать из integrations_auth: access_token, refresh_token, token_expires_at.  
    - Если access_token есть и не истёк (с буфером 1–2 минуты) — вернуть его.  
    - Иначе при наличии refresh_token — запрос refresh, обновить в БД access_token и token_expires_at, вернуть новый access_token.  
    - Иначе вернуть null.  
- **В callback**: при повторном подключении не перезаписывать refresh_token пустым значением (как в Google): если TikTok не вернул refresh_token, подставлять существующий из БД.  
- **Где использовать хелпер**: в `/api/oauth/tiktok/integration/status`, в `/api/oauth/tiktok/insights/sync`, в endpoint получения списка advertisers — везде брать токен только через getValidTikTokAccessToken.

Так интеграция не будет «слетать» после истечения access_token при наличии действующего refresh_token.

---

# Раздел 5 — как тянуть advertiser accounts

- После успешного OAuth у TikTok в ответе на обмен кода иногда приходит список advertiser_ids; дополнительно список можно получить через **Advertiser List API** (например, `GET /open_api/v1.3/oauth2/advertiser/get/` или эквивалент из актуальной документации).  
- Логика по аналогии с Google accounts:  
  - POST (или GET) `/api/oauth/tiktok/accounts` с body `{ project_id }`.  
  - Разрешить integration по project_id и platform='tiktok'.  
  - Получить access_token через getValidTikTokAccessToken.  
  - Вызвать TikTok API списка advertisers.  
  - Для каждого advertiser id (и при необходимости имени) вставить/обновить записи в ad_accounts (integration_id, provider='tiktok', external_account_id = advertiser id, account_name), затем создать/обновить строки в ad_account_settings (is_enabled=false по умолчанию, sync_enabled=false).  
- Не создавать отдельную таблицу под TikTok; использовать только ad_accounts + ad_account_settings. При необходимости иерархии (Business Center → Advertisers) можно позже завести integration_entities по образцу Google.

---

# Раздел 6 — как тянуть spend / campaigns

- **Источник данных**: TikTok Marketing API отчёты — например Report Integrated Get (`/open_api/v1.3/report/integrated/get/`) или асинхронный Report Task (create + poll). Параметры: advertiser_id, даты (формат YYYYMMDD или как в доке), метрики (spend, impressions, clicks и т.д.), уровень группировки (по кампании, по дню).  
- **Endpoint синка**: GET `/api/oauth/tiktok/insights/sync?project_id=...&ad_account_id=...&date_start=...&date_end=...` (ad_account_id = наш ad_accounts.id или external_account_id — в коде однозначно определить: по ad_accounts.id находить external_account_id для вызова API).  
- **Логика**:  
  - Разрешить integration (project_id, platform=tiktok), получить токен через getValidTikTokAccessToken.  
  - Найти ad_account по integration_id и external_account_id (TikTok advertiser id).  
  - Создать запись в sync_runs (status=running).  
  - Запросить отчёт за период (account-level и при необходимости campaign-level).  
  - Маппинг: TikTok spend → daily_ad_metrics.spend, impressions, clicks; дата в формате YYYY-MM-DD.  
  - Account-level: вставка/обновление строк daily_ad_metrics (ad_account_id, campaign_id=null, date, platform='tiktok').  
  - Campaign-level: upsert campaigns по external_campaign_id (ad_account_id = наш ad_accounts.id), затем вставка daily_ad_metrics с campaign_id.  
  - Уникальность: как у Meta/Google — delete-then-insert по диапазону дат для выбранного ad_account_id (и при необходимости campaign_id).  
  - По окончании обновить sync_runs (status=ok/error, rows_written, error_message, meta).  
- **Формат дат и имён полей** взять из актуальной TikTok Reporting API (часто stat_time_day, cost, impressions, clicks и т.д.).

---

# Раздел 7 — как TikTok должен участвовать в attribution и LTV

- **ttclid**: уже обрабатывается в `trafficSourceDetection.ts` — при наличии ttclid выставляются traffic_source='tiktok', traffic_platform='tiktok_ads'.  
- **redirect_click_events / visit_source_events**: при сохранении событий нужно передавать в detectTrafficSource параметр ttclid (и при необходимости utm_source, referrer); записанные traffic_source и traffic_platform уже поддерживают tiktok / tiktok_ads (миграция traffic_source_platform_columns).  
- **conversion_events**: те же поля traffic_source / traffic_platform — для атрибуции конверсий на TikTok трафик.  
- **LTV / attribution**: движки атрибуции (attributionModels, topAttributionPaths, revenue attribution и т.д.) должны учитывать source/platform; раз уже есть нормализация meta/google/tiktok и ALLOWED_PLATFORMS включает tiktok, достаточно убедиться, что при фильтрации по источникам и агрегации по платформам TikTok включён (sources включают 'tiktok', платформа 'tiktok' участвует в расчётах).  
- **Dashboard**: в dashboardCanonical и dashboard/accounts при добавлении TikTok нужно включать TikTok integration_ids в resolveAdAccountIds и в запросы daily_ad_metrics (platform = 'tiktok'); в summary/timeseries фильтр sources уже допускает 'tiktok'.  
- **Backfill**: в dashboardBackfill добавить платформу 'tiktok' (getAdAccountIdsForProjectByPlatform, ensureBackfill), чтобы по запросу диапазона дат при необходимости запускался синк и для TikTok.

Итого: клик по TikTok объявлению (ttclid) → фиксация в redirect_click_events с traffic_source=tiktok; визит и конверсия — с тем же источником; дашборд и LTV считают TikTok наравне с Meta и Google при выборе источников.

---

# Раздел 8 — пошаговый implementation plan

1. **Конфигурация и OAuth**
   - Добавить env: TIKTOK_CLIENT_KEY, TIKTOK_CLIENT_SECRET, TIKTOK_REDIRECT_URI (и при необходимости TIKTOK_APP_ID).  
   - Реализовать GET `/api/oauth/tiktok/start` (state, scopes, redirect на TikTok authorize).  
   - Реализовать GET `/api/oauth/tiktok/callback`: обмен code → tokens, upsert integrations + integrations_auth с сохранением существующего refresh_token при его отсутствии в ответе.  

2. **Token refresh**
   - Создать `app/lib/tiktokAdsAuth.ts` с getValidTikTokAccessToken (чтение БД, проверка срока, refresh при необходимости, обновление БД).  
   - Использовать только этот хелпер для всех последующих запросов к TikTok API.  

3. **Status и disconnect**
   - GET `/api/oauth/tiktok/integration/status?project_id=...`: интеграция есть + getValidTikTokAccessToken не null → valid: true.  
   - POST `/api/oauth/tiktok/integration/disconnect`: по образцу Google — удалить ad_account_settings, ad_accounts, integrations_auth для данной интеграции; integrations строку можно оставить для повторного подключения.  

4. **Advertiser list**
   - POST (или GET) `/api/oauth/tiktok/accounts` с project_id: getValidTikTokAccessToken, вызов TikTok Advertiser List API, upsert ad_accounts (provider='tiktok', external_account_id, account_name), upsert ad_account_settings.  

5. **Connections save**
   - POST `/api/oauth/tiktok/connections/save`: body { project_id, ad_account_ids: string[] } — обновить ad_account_settings (is_enabled, selected_for_reporting) для выбранных external_account_id, по аналогии с Google.  

6. **Insights sync**
   - GET `/api/oauth/tiktok/insights/sync`: project_id, ad_account_id (наш id или external — зафиксировать контракт), date_start, date_end. Токен через getValidTikTokAccessToken, вызов TikTok Report API, запись daily_ad_metrics (account + при возможности campaign), sync_runs, при необходимости campaigns.  

7. **Dashboard и backfill**
   - В `app/api/dashboard/accounts/route.ts`: при сборе integrationIds добавить integrations где platform='tiktok'.  
   - В `app/lib/dashboardCanonical.ts`: в resolveAdAccountIds включить TikTok (integrations где platform='tiktok'); в fetchCanonicalRowsViaJoin расширить .in("platform", ["meta", "google", "tiktok"]).  
   - В `app/lib/dashboardBackfill.ts`: добавить platform 'tiktok' в getAdAccountIdsForProjectByPlatform и в ensureBackfill (триггер синка для TikTok при нехватке данных за диапазон).  

8. **UI (Accounts)**
   - На странице аккаунтов: опрос `/api/oauth/tiktok/integration/status`, отображение кнопки «Подключить TikTok» / статуса подключения, список аккаунтов TikTok из /api/dashboard/accounts (platform=tiktok), выбор аккаунтов и вызов connections/save, кнопка disconnect по аналогии с Google.  
   - При необходимости — вызов POST /api/oauth/tiktok/accounts после первого подключения, чтобы заполнить список рекламных аккаунтов.  

9. **Проверка attribution**
   - Убедиться, что везде, где создаются redirect_click_events / visit_source_events / conversion_events, передаётся ttclid в detectTrafficSource и сохраняются traffic_source / traffic_platform.  
   - Проверить отчёты атрибуции и LTV при выборе source tiktok.  

10. **Документация и тесты**
    - Обновить/добавить описание env для TikTok.  
    - Зафиксировать актуальные TikTok API endpoints и scopes в коде или в docs.  
    - По возможности добавить e2e или интеграционные тесты для OAuth и синка (хотя бы вручную).

Этот план позволяет встроить TikTok Ads в текущую архитектуру без ломки Meta и Google и с единообразным подходом к токенам, аккаунтам и синку.

---

## Справка: TikTok API (для реализации)

- **OAuth authorize**: `https://www.tiktok.com/auth/authorize/` (или актуальный URL из TikTok for Developers).  
- **Token (code exchange / refresh)**: `POST https://open.tiktokapis.com/v2/oauth/token/` — body: grant_type, client_key, client_secret, redirect_uri и code либо refresh_token.  
- **Advertiser list**: обычно `GET /open_api/v1.3/oauth2/advertiser/get/` (проверить в портале TikTok Marketing API).  
- **Reporting**: `GET /open_api/v1.3/report/integrated/get/` (sync) или `POST/GET report/task/create/` + `report/task/check/` (async).  
- **Scopes**: уточнить в TikTok for Developers; типично что-то вроде user.info.basic, advertiser.list, report.insight (или аналог для отчётов).  
- **Access token**: ~24h; **refresh token**: до 365 дней. Refresh обязателен для устойчивой работы без повторного логина.
