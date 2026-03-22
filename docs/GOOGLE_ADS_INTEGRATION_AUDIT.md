# Аудит Google Ads integration: почему интеграция периодически слетает

## Итог

**Основные причины слёта:**

1. **Потеря `refresh_token` при повторном подключении** — в callback при upsert в `integrations_auth` всегда передаётся `refresh_token: tokenJson.refresh_token ?? null`. Google при повторной авторизации часто **не возвращает** refresh_token. В результате мы перезаписываем существующий refresh_token пустым значением и навсегда теряем возможность обновлять access token.
2. **Отсутствие логики обновления токена** — ни `/api/oauth/google/integration/status`, ни `/api/oauth/google/insights/sync`, ни `/api/oauth/google/accounts` не проверяют `token_expires_at` и не вызывают обновление токена через refresh_token. Access token живёт ~1 час; после истечения все запросы к Google Ads API падают.
3. **Статус «disconnected» при истёкшем токене** — endpoint status считает интеграцию невалидной при истёкшем access_token и не пытается обновить его по refresh_token. UI показывает «не подключено» даже когда интеграция в БД есть и refresh_token сохранён.

**Места в коде:**

- Потеря refresh_token: `app/api/oauth/google/callback/route.ts` — upsert с `refresh_token: refreshToken` без проверки «сохранять ли старый».
- Нет refresh: во всём проекте нет вызовов `grant_type=refresh_token` к `https://oauth2.googleapis.com/token`.
- Статус без refresh: `app/api/oauth/google/integration/status/route.ts` — только проверка `access_token` и `token_expires_at`, без попытки обновления.

---

## 1. OAuth flow

### Сохраняется ли refresh_token

- **Да**, при первом успешном callback мы пишем в `integrations_auth` и `access_token`, и `refresh_token`, и `token_expires_at`.
- **Но**: при повторном заходе пользователя в OAuth (например, «переподключить») Google часто отдаёт в ответе только `access_token` и `expires_in`, **без** `refresh_token` (refresh_token выдаётся при первом согласии или при явном повторном согласии).
- В callback используется `const refreshToken = tokenJson.refresh_token ?? null` и в upsert передаётся `refresh_token: refreshToken`. То есть при повторном подключении мы **перезаписываем** существующий refresh_token значением `null` и теряем его навсегда.

### Scopes

- Запрашивается один scope: `https://www.googleapis.com/auth/adwords` (`app/api/oauth/google/start/route.ts`).
- В callback при обмене кода на токен приходят `access_token`, `expires_in`, опционально `refresh_token`, `scope`, `token_type`.

### Callback

- Обмен кода на токен: POST `https://oauth2.googleapis.com/token` с `grant_type=authorization_code`, `code`, `client_id`, `client_secret`, `redirect_uri`.
- Успех: upsert `integrations` (project_id, platform=google, status=active), затем upsert `integrations_auth` (integration_id, access_token, refresh_token, token_expires_at, scopes, meta). Проблема только в перезаписи refresh_token пустым при повторном подключении.

---

## 2. Хранение интеграции в БД

### Где лежат access_token / refresh_token

- Таблица **`integrations_auth`**: одна запись на интеграцию (`integration_id`), поля `access_token`, `refresh_token`, `token_expires_at`, `scopes`, `meta`, `updated_at`. Связь: `integrations.id` → `integrations_auth.integration_id`.

### Перезапись refresh_token

- **Да.** В callback при каждом успешном OAuth делается полный upsert строки `integrations_auth` с телом, в котором `refresh_token: refreshToken` (может быть null). Если Google не вернул refresh_token при повторном подключении, мы затираем старый сохранённый refresh_token.

### customer_id / ads account id

- В `integrations` нет поля customer_id.
- Идентификаторы рекламных аккаунтов хранятся в **`ad_accounts`** (integration_id, `external_account_id` для Google = customer id в формате цифр), плюс **`integration_entities`** (entity_type manager/customer, external_entity_id). Customer IDs доступны через ad_accounts и integration_entities.

### last_successful_sync / last_error

- В таблице **`integrations`** таких полей нет (только id, project_id, platform, created_at, updated_at, в части миграций — name, status, integration_type).
- Результаты синков пишутся в **`sync_runs`** (project_id, platform, ad_account_id, sync_type, status, finished_at, rows_written, error_message, meta). То есть «последняя ошибка/успех» можно вывести из sync_runs, но не из integrations.

---

## 3. Token refresh logic

### Как и когда обновляется access token

- **Никак и никогда.** В коде нет вызовов обновления токена (нет запросов к `oauth2.googleapis.com/token` с `grant_type=refresh_token`). Используется только обмен кода на токен в callback.

### Что происходит при истечении access token

- Все запросы, которые берут только access_token из БД (status, accounts, insights/sync), начинают получать 401 от Google. Ошибки пробрасываются наверх; sync помечает sync_runs как error. Пользователь видит сбой синка или «интеграция не подключена».

### Влияние на UI

- **integration/status** возвращает `valid: false`, если нет access_token или токен истёк (`token_expires_at <= now`). UI (Accounts) считает Google «не подключённым» при `valid: false`. То есть одна только истечение access_token (без отзыва OAuth) переводит интеграцию в состояние «disconnected» в интерфейсе.

---

## 4. Google Ads API access

### Доступ к customer account

- Список доступных кастомеров: `customers:listAccessibleCustomers`. Дальше по каждому id запрашиваются Customer и при необходимости CustomerClient (MCC). Права определяются тем Google-аккаунтом, которым пользователь авторизовался; если у этого аккаунта нет доступа к нужному Ads-аккаунту, соответствующие вызовы будут падать с ошибкой доступа.

### MCC / sub-account

- В `accounts` route обрабатываются и manager-аккаунты (MCC), и standalone customers, и клиенты под менеджерами (CustomerClient). Ошибки доступа к конкретному customer логируются через `console.warn` и не ломают весь flow; недоступные кастомеры просто не попадают в список. Явных багов по MCC в логике не видно; слёты связаны в первую очередь с токенами, а не с иерархией аккаунтов.

---

## 5. UI status logic

### На каком основании интеграция помечается как disconnected

- Страница аккаунтов вызывает `GET /api/oauth/google/integration/status?project_id=...`. Ответ `valid: false` приводит к тому, что Google считается неподключённым (`setGoogleConnected(googleValid)`).

### OAuth disconnected vs sync error

- **Не разделены.** Статус основан только на наличии и сроке действия access_token (и теперь — на возможности обновить его по refresh_token после фикса). Отдельного флага «OAuth отозван» vs «временная ошибка синка» в API и UI нет: при любом `valid: false` показывается одно и то же состояние «не подключено».

---

## Рекомендации по исправлению

1. **Callback: не перезаписывать refresh_token пустым**
   - Перед upsert в `integrations_auth` загрузить текущую строку по `integration_id`.
   - Если в ответе Google `refresh_token` пустой/отсутствует — в payload upsert подставлять **текущий** `refresh_token` из БД (если он есть), а не null. Таким образом при повторном подключении старый refresh_token сохранится.

2. **Ввести обновление access token по refresh_token**
   - Вынести в общий хелпер (например, `getValidGoogleAccessToken(admin, integrationId)`): прочитать access_token, refresh_token, token_expires_at; если токен истёк и есть refresh_token — вызвать `oauth2.googleapis.com/token` с `grant_type=refresh_token`, обновить в БД access_token и token_expires_at; вернуть актуальный access_token или null.
   - Использовать этот хелпер в:
     - `GET /api/oauth/google/integration/status` — перед проверкой «valid» попытаться получить валидный токен; при успехе возвращать valid: true.
     - `GET /api/oauth/google/insights/sync` и `POST /api/oauth/google/accounts` — брать access_token через хелпер, а не напрямую из БД, чтобы при истечении токена автоматически делать refresh.

3. **Опционально: разделение состояний в UI**
   - В status (или отдельном endpoint) можно возвращать, например, `reason: "token_expired" | "oauth_revoked" | "no_integration"`, чтобы в UI различать «нужно переподключить» и «временная ошибка / идёт обновление токена». Это не обязательный минимум для устранения «периодического слёта», но улучшит понятность.

После внедрения п.1 и п.2 интеграция перестанет «слетать» из-за истечения access_token и потери refresh_token при повторном OAuth.

---

## Внесённые исправления

1. **Callback** (`app/api/oauth/google/callback/route.ts`): при повторном подключении, если Google не вернул `refresh_token`, в upsert подставляется существующий `refresh_token` из БД (предварительный select по `integration_id`), чтобы не перезаписывать его пустым значением.

2. **Хелпер обновления токена** (`app/lib/googleAdsAuth.ts`): функция `getValidGoogleAccessToken(admin, integrationId)` возвращает валидный access_token — либо текущий (если не истёк, с буфером 1 мин), либо после обновления через `grant_type=refresh_token` с записью новых access_token и token_expires_at в БД.

3. **Status** (`app/api/oauth/google/integration/status/route.ts`): использует `getValidGoogleAccessToken`; возвращает `valid: true`, если удалось получить токен (в т.ч. после refresh).

4. **Insights sync** (`app/api/oauth/google/insights/sync/route.ts`) и **Accounts** (`app/api/oauth/google/accounts/route.ts`): получают access_token через `getValidGoogleAccessToken` вместо прямого чтения из БД, чтобы при истечении токена он обновлялся перед запросами к Google Ads API.
