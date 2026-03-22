# Технический аудит: sync layer рекламных кабинетов

Аудит проведён без изменений кода. Цель — оценить надёжность загрузки данных из рекламных платформ, слабые места и риски при масштабировании на Meta / Google / TikTok.

---

# РАЗДЕЛ 1 — Как сейчас устроен sync layer

## Схема: integration → auth → accounts → sync → metrics

```
projects
    └── integrations (1 на platform на project: meta | google | tiktok)
            └── integrations_auth (1:1: access_token, refresh_token, token_expires_at)
            └── ad_accounts (N: provider, external_account_id, account_name)
                    └── ad_account_settings (1:1: is_enabled, selected_for_reporting, sync_enabled)F 
                    └── campaigns (N: meta_campaign_id | external_campaign_id, ad_account_id text / ad_accounts_id uuid)
                    └── daily_ad_metrics (по date: account-level campaign_id IS NULL, campaign-level campaign_id NOT NULL)
    └── sync_runs (логи запусков: project_id, platform, ad_account_id, sync_type, status)
```

**Meta дополнительно:** legacy `integrations_meta` (project_id, account_id, access_token, expires_at) и `meta_ad_accounts`, `meta_insights`. Токен дублируется в `integrations_auth`; источник правды для Meta-токена — сначала integrations + integrations_auth, fallback integrations_meta. Синк пишет в `meta_insights` и параллельно в `daily_ad_metrics` (dual-write).

**Google:** только канонический слой (integrations + integrations_auth + ad_accounts). Токен обновляется через `getValidGoogleAccessToken` (refresh при истечении). Синк пишет только в `daily_ad_metrics` и `campaigns`.

**Триггер синка:**
- Вручную: POST `/api/dashboard/refresh` (body: project_id, start, end) или POST `/api/dashboard/sync?project_id=&start=&end=`.
- Автоматически: при GET summary/timeseries/metrics вызывается `ensureBackfill(admin, projectId, start, end, req.url)`. Если по campaign-level строкам диапазон не покрыт — внутри делается `fetch(/api/dashboard/sync)` с тем же диапазоном. Дедуп по ключу `projectId:start:end` в памяти (syncPromises Map).

**Чтение для дашборда:** `dashboardCanonical.ts` — `resolveAdAccountIds` (Meta через integrations_meta.integrations_id, Google через integrations где platform=google), затем выборка из view `daily_ad_metrics_campaign` (только строки с campaign_id IS NOT NULL). Итоги и таймсерии считаются только по campaign-level, чтобы не дублировать spend с account-level.

**Source of truth по сущностям:**
- **integrations** — каноник: один слот на (project, platform). Meta дополнительно представлена в integrations_meta.
- **ad_accounts** — каноник; уникальность (integration_id, external_account_id). Для Meta заполняются из callback; для Google — из POST `/api/oauth/google/accounts`.
- **daily_ad_metrics** — каноник для spend/impressions/clicks. Уникальность: (ad_account_id, date) для account-level, (ad_account_id, campaign_id, date) для campaign-level.
- **campaigns** — смешанная модель: Meta по (project_id, meta_campaign_id), Google по (ad_account_id text, external_campaign_id). В миграциях заведён ad_accounts_id (uuid) и unique (ad_accounts_id, external_campaign_id), но код Google использует ad_account_id (внешний id строкой) и onConflict "ad_account_id,external_campaign_id".

---

# РАЗДЕЛ 2 — Что работает корректно

1. **Единое хранилище метрик** — `daily_ad_metrics` с platform и двумя уровнями (account/campaign); view `daily_ad_metrics_campaign` исключает double-count при агрегации на дашборде.
2. **Delete-then-insert в рамках одного синка** — и Meta, и Google перед вставкой удаляют строки по тому же (ad_account_id, диапазон дат), что снижает риск дублей при последовательном запуске.
3. **Уникальные индексы** — (ad_account_id, date) и (ad_account_id, campaign_id, date) в daily_ad_metrics; (integration_id, external_account_id) в ad_accounts.
4. **Google token refresh** — `getValidGoogleAccessToken` обновляет access_token по refresh_token и пишет в БД; callback не затирает refresh_token при повторном подключении.
5. **sync_runs** — каждый синк создаёт запись (status=running), по завершении обновляет status/rows_written/error_message; можно смотреть последний запуск по ad_account.
6. **Дедуп backfill по ключу** — один и тот же (projectId, start, end) не запускает параллельно два sync; второй запрос ждёт тот же promise.
7. **Фильтрация по источникам** — summary/timeseries принимают sources и accountIds; resolveAdAccountIds учитывает platform и ad_account_settings.
8. **LTV** — использует `daily_ad_metrics_campaign` и campaigns для retention spend; источник метрик согласован с дашбордом.

---

# РАЗДЕЛ 3 — Критические проблемы (CRITICAL)

## 3.1 Meta: синк только одного аккаунта и без учёта is_enabled

**Файл:** `app/api/dashboard/sync/route.ts`  
Для Meta берётся **первый** ad_account по integration_id (`.limit(1)`), без фильтра по `ad_account_settings.is_enabled`. Для Google синк идёт по всем **enabled** аккаунтам из ad_account_settings.

**Последствия:**  
- Если у проекта несколько Meta-аккаунтов, синкатся только один (какой первым вернулся из БД).  
- Отключённый в UI аккаунт (is_enabled=false) всё равно может синкаться, если он первый в списке.  
- Данные по остальным Meta-аккаунтам не обновляются; дашборд по источникам meta показывает неполную картину.

## 3.2 Meta: нет обновления access_token (refresh)

**Файлы:** `app/lib/metaIntegration.ts`, `app/api/oauth/meta/integration/status/route.ts`  
Токен Meta берётся из integrations_auth (или integrations_meta); проверка только `expires_at`. Логики продления long-lived токена или обмена на новый в коде нет.

**Последствия:**  
После истечения срока токена (long-lived ~60 дней) статус Meta становится invalid, UI показывает «не подключено», хотя пользователь не отзывал доступ. В отличие от Google, восстановление только повторным OAuth.

## 3.3 Риск дублей/ошибок в campaigns для Google

**Файл:** `app/api/oauth/google/insights/sync/route.ts`  
Upsert кампаний: `onConflict: "ad_account_id,external_campaign_id"`. В миграциях уникальный индекс по campaigns — `(ad_accounts_id, external_campaign_id)` (07500000), а не (ad_account_id, external_campaign_id). В коде в строки передаётся `ad_account_id: externalAccountId` (строка — внешний customer id).

**Последствия:**  
В миграциях заведён только unique по (ad_accounts_id, external_campaign_id). Код Google использует onConflict "ad_account_id,external_campaign_id" и пишет ad_account_id = externalAccountId (строка). Нужно проверить в реальной БД наличие уникального ограничения на (ad_account_id, external_campaign_id). При его отсутствии upsert может давать дубли или ошибку; при наличии — согласовать с ad_accounts_id (например, заполнять ad_accounts_id в строках Google и использовать onConflict по ad_accounts_id).

## 3.4 Dashboard читает только campaign-level; при отсутствии кампаний — нули

**Файлы:** `app/lib/dashboardCanonical.ts`, view `daily_ad_metrics_campaign`  
Итоги и таймсерии строятся только по view `daily_ad_metrics_campaign` (campaign_id IS NOT NULL). Строки только account-level (campaign_id IS NULL) в расчёт не попадают.

**Последствия:**  
Если по какой-то платформе/аккаунту синк записал только account-level (например, сбой до блока кампаний или API не вернул кампании), дашборд по этому источнику покажет 0, хотя в daily_ad_metrics есть ненулевой spend. Риск «пустого» дашборда при частично успешном синке.

## 3.5 Backfill вызывается на каждый запрос summary/timeseries/metrics при непокрытом диапазоне

**Файлы:** `app/lib/dashboardBackfill.ts`, `app/api/dashboard/summary/route.ts`, `app/api/dashboard/timeseries/route.ts`, `app/api/dashboard/metrics/route.ts`  
При каждом GET summary/timeseries/metrics вызывается `ensureBackfill`. Если за диапазон нет campaign-level строк — выполняется POST /api/dashboard/sync, причём **ожидание завершения** (await promise) внутри запроса.

**Последствия:**  
Первый запрос за новый диапазон может занимать десятки секунд (синк Meta + N аккаунтов Google). Таймауты и плохой UX; при частой смене диапазона или многих пользователях — высокая нагрузка на API и внешние платформы. Нет ограничения частоты вызова sync из backfill.

---

# РАЗДЕЛ 4 — Средние проблемы (MEDIUM)

## 4.1 Нет защиты от параллельного синка одного и того же ad_account/диапазона

**Файлы:** `app/api/oauth/meta/insights/sync/route.ts`, `app/api/oauth/google/insights/sync/route.ts`  
Дедуп есть только на уровне backfill по ключу (projectId, start, end). Два одновременных запроса sync для одного и того же ad_account и одного диапазона (например, ручной refresh + backfill) могут выполняться параллельно: два delete/insert по одному и тому же ad_account_id и датам.

**Риск:** при неблагоприятном порядке операций возможны дубли или потеря части данных (interleaving delete/insert двух потоков). При росте нагрузки вероятность растёт.

## 4.2 Нет транзакций: частичная запись при падении синка

**Файлы:** Meta и Google insights/sync  
Синк: запись sync_runs (running) → account-level delete/insert → campaign-level цикл (Meta по чанкам) → update sync_runs (ok/error). Нет единой транзакции. При падении после записи account-level и до записи campaign-level в БД остаётся только account-level; дашборд (читающий только campaign-level) покажет 0 за этот диапазон.

**Риск:** неконсистентное состояние и расхождение «сырых» данных с тем, что видит пользователь.

## 4.3 Разный источник списка аккаунтов для Meta и Google в dashboard/accounts

**Файл:** `app/api/dashboard/accounts/route.ts`  
integrationIds собираются: Meta — из integrations_meta.integrations_id, Google — из integrations где platform=google. TikTok не учитывается (нет выборки platform=tiktok). Для единообразия и добавления TikTok лучше один запрос: integrations по project_id и platform in ('meta','google','tiktok').

**Риск:** при появлении TikTok аккаунты TikTok не появятся в списке; возможны расхождения, если у Meta когда-то убрают дублирование с integrations.

## 4.4 resolveAdAccountIds и backfill не включают TikTok

**Файлы:** `app/lib/dashboardCanonical.ts`, `app/lib/dashboardBackfill.ts`  
В resolveAdAccountIds только meta (integrations_meta) и google (integrations). В backfill getAdAccountIdsForProjectByPlatform только meta и google. TikTok при добавлении не будет участвовать в дашборде и в автоматическом синке через backfill, пока не поправить оба места.

## 4.5 Meta sync: canonicalAdAccountId может быть null

**Файл:** `app/api/oauth/meta/insights/sync/route.ts`  
canonicalAdAccountId вычисляется по integrations_id и ad_accounts.external_account_id. Если по какой-то причине строки в ad_accounts для этого Meta аккаунта нет (например, callback не создал или рассинхрон), canonicalAdAccountId остаётся null — в daily_ad_metrics ничего не пишется, но meta_insights обновляется и sync_runs помечается ok. Дашборд не увидит данные.

## 4.6 ad_account_settings и «участие в дашборде»

**Файлы:** `app/api/dashboard/accounts/route.ts`, `app/lib/dashboardCanonical.ts`  
Участие в отчётах определяется: в accounts — is_enabled из ad_account_settings (и fallback meta_ad_accounts для Meta); в resolveAdAccountIds фильтр по sources (platform), но не по is_enabled. То есть в канонической выборке метрик участвуют все ad_accounts по выбранным платформам, а не только с is_enabled. Нужно явно зафиксировать: дашборд должен учитывать только is_enabled или все аккаунты интеграции — и везде придерживаться одного правила.

## 4.7 Кэш summary и backfill

**Файл:** `app/api/dashboard/summary/route.ts`  
Кэш читается только если `!didSync`. После синка кэш не инвалидируется; следующий запрос с теми же параметрами получит старый ответ до истечения TTL. После успешного backfill пользователь может ещё раз запросить summary и не увидеть свежие данные, пока кэш жив.

---

# РАЗДЕЛ 5 — Риски перед TikTok

1. **Один источник списка интеграций** — в dashboard/accounts и dashboardCanonical нужно добавить TikTok (integrations где platform=tiktok), иначе TikTok-аккаунты не появятся и не попадут в фильтры.
2. **Backfill** — в getAdAccountIdsForProjectByPlatform и в ensureBackfill добавить платформу tiktok; иначе автоматический синк при открытии дашборда для TikTok не запустится.
3. **dashboard/sync** — сейчас явно перечислены Meta и Google; при добавлении TikTok нужен такой же блок (enabled TikTok-аккаунты, вызов TikTok insights/sync).
4. **Единый контракт «enabled»** — для Meta сейчас в sync берётся первый аккаунт без проверки is_enabled. Для TikTok (и для консистентности Meta) синк должен идти только по аккаунтам с is_enabled из ad_account_settings.
5. **Token refresh** — для TikTok обязателен паттерн как у Google (getValidTikTokAccessToken + сохранение refresh_token в callback), иначе интеграция будет «отваливаться» после истечения access_token.
6. **campaigns** — у Google в коде используется ad_account_id (строка); в схеме — ad_accounts_id (uuid). Перед добавлением TikTok стоит унифицировать: либо везде external id в отдельном поле и ad_accounts_id как FK, либо явно задокументировать и проверить уникальность для каждой платформы, чтобы TikTok не попал на тот же конфликт.
7. **Статус интеграции** — разделить «OAuth valid» и «последний синк успешен» (например, через sync_runs / last_sync_status), чтобы в UI не смешивать «disconnected» из-за истёкшего токена и «подключено, но синк с ошибкой».

---

# РАЗДЕЛ 6 — Что исправить в приоритетном порядке

## Must fix (до масштабирования / перед TikTok)

1. **Meta sync: учитывать is_enabled и синкать все включённые Meta-аккаунты** — в `app/api/dashboard/sync/route.ts` для Meta брать ad_accounts по integration_id и join с ad_account_settings где is_enabled=true (и при необходимости project_id), синкать каждый такой аккаунт; убрать limit(1) без фильтра.
2. **Проверить и при необходимости исправить campaigns для Google** — убедиться, что в БД есть уникальность, соответствующая onConflict "ad_account_id,external_campaign_id", или перейти на (ad_accounts_id, external_campaign_id) и в коде Google передавать ad_accounts_id (uuid нашего ad_accounts).
3. **Защита от параллельного синка одного ad_account + диапазона** — введение блокировки (например, по (ad_account_id, date_start, date_end) в Redis или в БД) на время выполнения sync для этого аккаунта и периода; при занятой блокировке возвращать 409 или ждать.
4. **Backfill не блокировать пользовательский запрос** — не вызывать await ensureBackfill перед ответом; запускать sync в фоне (fire-and-forget или очередь) и сразу отдавать данные из того, что есть (или «данные обновляются»). Либо вынести проверку покрытия и запуск sync в отдельный job/route.

## Should fix

5. **Meta: продление токена** — по возможности реализовать обновление long-lived токена Meta по документации и вызывать его при истечении (или при статусе) и писать новый токен в integrations_auth; иначе явно документировать необходимость повторного подключения раз в ~60 дней.
6. **Единый источник списка интеграций** — в dashboard/accounts и в resolveAdAccountIds получать integrationIds одним запросом к integrations по project_id и platform in ('meta','google','tiktok'), без отдельной логики для Meta через integrations_meta (integrations_meta оставить только для обратной совместимости токена Meta при необходимости).
7. **Дашборд и account-level** — либо документировать, что «дашборд = только campaign-level», и при отсутствии кампаний показывать явное сообщение; либо при отсутствии campaign-level за диапазон подставлять агрегат по account-level для этого ad_account/платформы, чтобы не показывать нули при наличии данных.
8. **Фильтр по is_enabled в resolveAdAccountIds** — при выборке ad_accounts для метрик учитывать только те, у которых в ad_account_settings is_enabled=true для данного project_id, чтобы дашборд и отчёты считали только выбранные пользователем аккаунты.

## Nice to have

9. **Инвалидация кэша summary после sync** — при успешном завершении sync сбрасывать или помечать невалидным кэш по соответствующему project_id/диапазону/источникам.
10. **Отдельные поля/статусы для «OAuth valid» и «last sync success»** — в API статуса и в UI различать «подключено, токен ок» и «последний синк успешен/ошибка», не смешивать с «disconnected».
11. **Транзакционная запись синка** — по возможности оборачивать запись account-level + campaign-level + update sync_runs в одну транзакцию (с учётом ограничений Supabase и объёма данных).

---

# Ответы на 5 вопросов

**1. Готов ли текущий sync layer к масштабированию на 3 канала?**  
Не полностью. Схема БД и общий поток (integrations → ad_accounts → daily_ad_metrics) позволяют добавить TikTok. Но: Meta синкает только один аккаунт и не учитывает is_enabled; нет защиты от параллельного синка; backfill блокирует запросы; возможен конфликт по campaigns для Google; дашборд не учитывает TikTok без правок в dashboardCanonical и dashboardBackfill. Без исправлений из раздела «Must fix» масштабирование рискованно.

**2. Где самое слабое место архитектуры?**  
Самое слабое — **разная логика по платформам** (Meta: один аккаунт без is_enabled, Google: все enabled) и **отсутствие единого контракта** «какие аккаунты синкать» и «откуда читать метрики». Второе — **блокирующий backfill** на каждом запросе при непокрытом диапазоне и **отсутствие блокировок** при параллельном синке одного и того же аккаунта/периода.

**3. Есть ли риск искажения spend / metrics?**  
Да. (1) Дубли при параллельном синке одного ad_account/диапазона (теоретически). (2) Дашборд показывает только campaign-level — при наличии только account-level spend отображается как 0 (искажение в сторону занижения). (3) Если по Google в campaigns из-за onConflict создаются дубли или не те строки, маппинг campaign_id в daily_ad_metrics может быть некорректным. (4) При частичном падении синка (после account-level, до campaign-level) итог по дашборду 0 при ненулевом spend в БД.

**4. Можно ли безопасно подключать TikTok на текущей схеме?**  
Схему (таблицы, view, уникальные индексы) использовать можно. Безопасно подключать TikTok только после: приведения Meta к синку по всем enabled аккаунтам, введения защиты от параллельного синка, перевода backfill в неблокирующий режим (или ограничения частоты), проверки/исправления конфликта campaigns для Google. И сразу для TikTok: token refresh + сохранение refresh_token в callback, учёт TikTok в dashboard/accounts, dashboardCanonical, backfill и dashboard/sync.

**5. Что обязательно исправить до этого?**  
Обязательно: (1) Meta — синк по всем включённым аккаунтам, а не по первому. (2) Проверка и исправление уникальности/onConflict для campaigns (Google). (3) Защита от одновременного синка одного ad_account и диапазона дат. (4) Отвязка backfill от блокирующего вызова в запросе summary/timeseries/metrics (запуск в фоне или по расписанию). После этого можно подключать TikTok с учётом пунктов раздела 5.
