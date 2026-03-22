# Полный аудит системы трекинга и атрибуции

**Дата:** 2025-03-06  
**Задача:** Анализ текущего состояния (pixel, click tracking, visitor identity, conversion events, attribution logic). Изменения в коде не вносились.

**Исправления по итогам аудита (2025-03-30):** В conversion_events добавлено поле `session_id` (миграция `20250330000000_conversion_events_session_id.sql`). API конверсий принимает и сохраняет `session_id`. POST `/api/tracking/source` синхронизирован с pixel: принимает и пишет `session_id`, `fbp`, `fbc`. В tracker.js: `click_id` сохраняется в sessionStorage после redirect; глобальный `window.BoardIQ` с методами `getVisitorId()`, `getSessionId()`, `getClickId()` для передачи в conversion payload. Документация и UI пикселя обновлены: рекомендуются `user_external_id`, `visitor_id`, `session_id`, `click_id` для registration и purchase.

---

## SECTION 1 — PIXEL AUDIT (tracker.js)

### Какие параметры пиксель собирает при визите

**Источник:** `public/tracker.js` — payload формируется на каждом page load и отправляется через GET-пиксель на `/api/tracking/source/pixel`.

| Параметр        | Собирается | Примечание |
|-----------------|------------|------------|
| **visitor_id**  | ✅         | Создаётся/читается из cookie `as_visitor` |
| **session_id**  | ✅         | Генерируется в sessionStorage (`boardiq_session_id`) |
| **page_url**    | ❌         | В payload есть `landing_url: window.location.href` (фактически URL страницы) |
| **landing_url** | ✅         | `window.location.href` |
| **referrer**    | ✅         | `document.referrer` |
| **utm_source**  | ✅         | Из query |
| **utm_medium**  | ✅         | Из query |
| **utm_campaign**| ✅         | Из query |
| **utm_content** | ✅         | Из query |
| **utm_term**    | ✅         | Из query |
| **fbclid**      | ✅         | Из query |
| **gclid**       | ✅         | Из query |
| **ttclid**      | ✅         | Из query |
| **yclid**       | ✅         | Из query (доп. к заданному списку) |
| **fbc**         | ✅         | Из cookie `_fbc` |
| **fbp**         | ✅         | Из cookie `_fbp` |
| **touch_type**  | ✅         | `first` или `last` (по наличию cookie as_visitor) |
| **click_id**    | ✅         | Из query `bqcid` (если пользователь пришёл по redirect-ссылке) |
| **visit_id**    | ✅         | Генерируется на клиенте: `bqvid_` + random + timestamp |

**Итог:** Собираются все запрошенные параметры. Отдельного поля `page_url` в payload нет — используется `landing_url` как URL текущей страницы. В URL пикселя передаются: `visitor_id`, `site_id`, `landing_url`, `referrer`, `touch_type`, `_ts`, `visit_id`, и при наличии — все utm_*, gclid, fbclid, yclid, ttclid, session_id, fbp, fbc, click_id.

---

## SECTION 2 — IDENTITY STORAGE

### 1. Где создаётся visitor_id

- **Файл:** `public/tracker.js`, функция `getOrCreateVisitorId()`.
- **Логика:** Ищется cookie `as_visitor`. Если нет или длина < 10 — генерируется `v_` + random (36) + `_` + Date.now (36), записывается в cookie.
- **Формат:** `v_<random>_<timestamp36>`.

### 2. Где создаётся session_id

- **Файл:** `public/tracker.js`, функция `getSessionId()`.
- **Логика:** Читается `sessionStorage.getItem("boardiq_session_id")`. Если пусто — генерируется `s_` + random + timestamp, пишется в sessionStorage.
- **Формат:** `s_<random>_<timestamp36>`.

### 3. Где хранятся и срок жизни

| Идентификатор | Механизм хранения      | Срок жизни        | Домен |
|---------------|------------------------|-------------------|--------|
| **visitor_id**| Cookie `as_visitor`    | max-age = 365 дней| Домен страницы, где подключен tracker.js |
| **visitor_id**| Дубликат в localStorage `boardiq_visitor_id` | Бессрочно (пока не очистят) | Тот же |
| **visitor_id**| Глобально `window.boardiqVisitorId` | До закрытия вкладки | Тот же |
| **session_id**| sessionStorage `boardiq_session_id` | До закрытия вкладки | Тот же |

В БД `visitor_id` и `session_id` хранятся в каждой строке таблицы `visit_source_events` (колонки `visitor_id`, `session_id`). Отдельной таблицы «users» или «sessions» нет.

---

## SECTION 3 — CLICK TRACKING

### 1. Создаётся ли click_id при переходе

- **Да.** Click ID создаётся на сервере при редиректе: `app/r/[token]/route.ts`. Генерируется `bqcid = randomUUID()`, сохраняется в `redirect_click_events.bq_click_id`, передаётся в destination URL как query-параметр `bqcid`.

### 2. Сохраняется ли click_id

- **Да.** В таблице `redirect_click_events`: поле `bq_click_id`. В таблице `visit_source_events`: поле `click_id` (пиксель передаёт `bqcid` как `click_id`). В таблице `conversion_events`: поле `click_id` (если фронт передаёт при отправке конверсии).

### 3. Где хранится

- **redirect_click_events:** полный клик (bq_click_id, destination_url, utm_*, fbclid, gclid, ttclid, yclid, referrer, user_agent, ip, fbp, fbc, fingerprint_hash, traffic_source, traffic_platform).
- **visit_source_events:** в каждой записи визита поле `click_id` (если пользователь зашёл по ссылке с bqcid).
- **conversion_events:** поле `click_id` (если передано при отправке события).

### 4. Передаётся ли click_id в события

- **Визит:** да. Трекер читает `bqcid` из URL и передаёт в пиксель как `click_id`; API пикселя пишет в `visit_source_events.click_id`.
- **Конверсия:** да, если вызывающая сторона передаёт `click_id` в теле POST `/api/tracking/conversion`. API принимает и сохраняет `click_id` в `conversion_events`.

**Итог:** Click tracking реализован: bqcid создаётся при редиректе, сохраняется в redirect_click_events и передаётся на сайт; пиксель подхватывает bqcid и пишет в visit_source_events; конверсии могут нести click_id при ручной/интеграционной передаче.

---

## SECTION 4 — REDIRECT LOGIC

### Есть ли механизм landing → redirect → сайт

**Да.** Endpoint: `GET /r/[token]`.

### Flow

1. **Запрос:** Пользователь переходит по ссылке вида `https://<app>/r/<token>?utm_source=...&fbclid=...` (и т.д.).
2. **Rate limit:** Проверка по IP (`checkRedirectRateLimit`).
3. **Разрешение ссылки:** По `token` из БД выбирается запись `redirect_links` (project_id, destination_url, utm_*).
4. **Фиксация клика до перехода:** Вставка в `redirect_click_events`: генерируется `bqcid` (UUID), сохраняются destination_url, full_url, utm_source/medium/campaign/content/term, utm_id, fbclid, gclid, ttclid, yclid, referrer, user_agent, ip, fbp, fbc, fingerprint_hash, traffic_source, traffic_platform. Вызов `increment_redirect_link_clicks(p_link_id)`.
5. **Редирект:** Формируется URL назначения; к нему добавляются query-параметры: **bqcid**, utm_source, utm_medium, utm_campaign, utm_content, utm_term, utm_id, fbclid, gclid, ttclid, yclid, campaign_id, adset_id, ad_id, click_id (из входящего запроса). Редирект 302 на `dest.toString()`.

### Ответы на пункты

- **Фиксируется ли клик до перехода:** да, в `redirect_click_events`.
- **Сохраняются ли utm-параметры:** да, в redirect_click_events и передаются в destination URL.
- **Сохраняется ли click_id:** да, bqcid сохраняется в redirect_click_events и передаётся как `bqcid` в URL назначения.
- **Передаются ли параметры дальше:** да, UTM, click IDs и bqcid добавляются в destination URL.

---

## SECTION 5 — VISIT EVENT

### Отправляется ли событие visit

**Да.** Каждая загрузка страницы с подключённым tracker.js отправляет GET-запрос на `/api/tracking/source/pixel` (1x1 image beacon). На бэкенде это приводит к вставке одной строки в `visit_source_events`.

### Какие поля содержит visit (в БД)

Таблица **visit_source_events** (после всех миграций):

- id, visitor_id, site_id, landing_url, referrer  
- utm_source, utm_medium, utm_campaign, utm_content, utm_term  
- gclid, fbclid, yclid, ttclid  
- source_classification (paid | organic_search | organic_social | referral | direct | unknown)  
- touch_type (first | last)  
- session_id, fbp, fbc  
- click_id, visit_id  
- traffic_source, traffic_platform (детекция на бэкенде)  
- created_at  

### Связь visit с visitor_id и click_id

- **visitor_id:** да, каждая запись содержит `visitor_id` (обязательное поле).
- **click_id:** да, если пользователь зашёл по ссылке с `bqcid`, пиксель передаёт его, в БД сохраняется `visit_source_events.click_id`.
- **visit_id:** генерируется на клиенте (bqvid_), передаётся в пиксель и сохраняется в `visit_source_events.visit_id` — уникальный идентификатор визита.

---

## SECTION 6 — REGISTRATION EVENT

### Отправляется ли событие регистрации

**Да**, через API: `POST /api/tracking/conversion` с заголовком `X-BoardIQ-Key` (public_ingest_key проекта) и телом JSON. Допустимое имя события: `registration` (и `purchase`).

### Какие параметры принимаются и сохраняются

Из кода `app/api/tracking/conversion/route.ts`:

| Параметр           | Принимается | Сохраняется в conversion_events |
|--------------------|------------|----------------------------------|
| visitor_id         | ✅         | ✅                               |
| session_id         | ❌         | ❌ (поля в API и таблице нет)    |
| click_id           | ✅         | ✅                               |
| user_external_id   | ✅         | ✅                               |
| utm_source         | ✅         | ✅                               |
| utm_medium/campaign/content/term | ✅ | ✅                        |
| event_name, event_time, value, currency, fbp, fbc, metadata, source, external_event_id | ✅ | ✅ |
| traffic_source, traffic_platform | Вычисляются на бэкенде по utm/referrer | ✅ |

**Отсутствует в конверсиях:** явная передача и хранение `session_id`.

---

## SECTION 7 — PURCHASE EVENT

### Отправляется ли событие покупки

**Да.** Тот же endpoint `POST /api/tracking/conversion` с `event_name: "purchase"`.

### Передаются ли указанные поля

- **visitor_id** — да, принимается и сохраняется.
- **session_id** — нет, не предусмотрено в API и в таблице.
- **click_id** — да.
- **user_external_id** — да.
- **value, currency** — да (для покупок).

### Связь purchase с visit

- **В БД:** прямой связи по внешнему ключу нет. Связь строится по **visitor_id** и времени: конверсия привязывается к визитам того же visitor_id с `created_at < conversion.created_at` (логика в `app/lib/assistedAttribution.ts`). Таким образом, purchase связывается с visit через общий visitor_id и порядок по времени.

---

## SECTION 8 — FIRST TOUCH LOGIC

### Сохраняется ли первый источник

**Да**, но не в виде отдельных полей first_touch_source/campaign/medium в БД.

- В **visit_source_events** каждая строка имеет **touch_type**: `first` или `last`. Первый визит (когда cookie as_visitor ещё не было) помечается как `first`, остальные — `last`.
- Отдельных колонок `first_touch_source`, `first_touch_campaign`, `first_touch_medium` в таблицах **нет**. First touch выводится при анализе: в `assistedAttribution.ts` по всем визитам до конверсии первое по времени касание считается first_touch, последнее — last_touch, остальные — assist. Агрегаты (revenue_first_touch, top_first_touch_channel и т.д.) считаются в коде (attributionModels, budgetOptimizationInsights, attributionJourney), а не хранятся в одной таблице.

**Где по сути хранится:** в наборе строк `visit_source_events` по visitor_id + site_id; first touch — строка с минимальным created_at (и/или touch_type=first для этого визита).

---

## SECTION 9 — LAST TOUCH LOGIC

### Определяется ли последний источник

**Да.**

- В **visit_source_events** каждому визиту ставится touch_type; при повторных визитах — `last`.
- В аналитике (assisted attribution, revenue attribution, debugger) последний визит до конверсии считается last_touch; для него используются traffic_source / traffic_platform из этой записи. Отдельных колонок last_touch_source/last_touch_campaign в БД нет — они выводятся как результат выборки и расчёта в коде.

---

## SECTION 10 — ASSISTED ATTRIBUTION (история касаний)

### Сохраняется ли история касаний

**Да.** Явной таблицы `visit_history` или `touch_history` нет, но эквивалент реализован:

- Каждый визит = одна строка в **visit_source_events** (visitor_id, visit_id, click_id, traffic_source, traffic_platform, created_at, utm_*, referrer и т.д.).
- Для конверсии в `assistedAttribution.ts` выбираются все визиты с тем же `visitor_id` и `created_at < conversion.created_at`, сортируются по created_at; по ним строится путь с ролями first_touch, assist, last_touch.

### Можно ли восстановить цепочку типа «Meta Ads → Direct → Purchase»

**Да.** Цепочка восстанавливается по visitor_id: все визиты до конверсии дают порядок касаний; по полям traffic_source, traffic_platform (и при необходимости utm_*, click_id) можно увидеть последовательность каналов (например Meta → direct) и связать с конверсией.

---

## SECTION 11 — DATABASE STRUCTURE

Отдельных таблиц с именами **visits**, **users**, **clicks** в миграциях нет. Используются следующие.

### visit_source_events (визиты)

- id (uuid PK), visitor_id (text, NOT NULL), site_id (text, NOT NULL)  
- landing_url, referrer (text)  
- utm_source, utm_medium, utm_campaign, utm_content, utm_term (text)  
- gclid, fbclid, yclid, ttclid (text)  
- source_classification (text, CHECK paid/organic_search/organic_social/referral/direct/unknown)  
- touch_type (text, DEFAULT 'last', CHECK first/last)  
- created_at (timestamptz)  
- session_id, fbp, fbc (text) — добавлены миграцией  
- visit_id, click_id (text) — добавлены миграцией  
- traffic_source, traffic_platform (text) — добавлены миграцией  

Индексы: visitor_id, site_id, created_at, (visitor_id, site_id), session_id, visit_id, click_id, traffic_source.

### conversion_events (конверсии)

- id (uuid PK), project_id (uuid, NOT NULL), source (text), event_name (text, NOT NULL), event_time (timestamptz), external_event_id, user_external_id, visitor_id, click_id, fbp, fbc  
- utm_source, utm_medium, utm_campaign, utm_content, utm_term  
- value (numeric), currency (text), metadata (jsonb), created_at (timestamptz)  
- traffic_source, traffic_platform (добавлены миграцией)

Индексы: visitor_id, project_id, event_time, traffic_source.

### redirect_links (ссылки редиректа)

- id (uuid PK), project_id (uuid, FK), token (text, UNIQUE), destination_url (text), utm_source, utm_medium, utm_campaign, utm_content, utm_term, created_at  
- clicks_count, last_click_at (добавлены миграцией)

### redirect_click_events (клики редиректа)

- id (uuid PK), project_id (uuid, FK), redirect_link_id (uuid, FK), bq_click_id (text), destination_url, full_url  
- utm_source, utm_medium, utm_campaign, utm_content, utm_term, utm_id, fbclid, gclid, ttclid, yclid, referrer, user_agent, ip, fbp, fbc  
- created_at, fingerprint_hash, traffic_source, traffic_platform  

Индексы: project_id, redirect_link_id, bq_click_id, created_at, fingerprint_hash, traffic_source.

**Итог:** «visits» = visit_source_events, «conversions» = conversion_events, «clicks» = redirect_click_events; отдельной таблицы «users» нет.

---

## SECTION 12 — ATTRIBUTION MODEL

- **First touch / Last touch:** Реализованы в коде. По visit_source_events для каждого visitor_id первый визит помечается first, последний перед конверсией используется как last_touch; first_touch и last_touch агрегируются по каналам (revenue, ROAS и т.д.) в attributionModels, budgetOptimizationInsights, revenueAttributionMap.
- **Multi-touch (assisted):** Реализован в `assistedAttribution.ts`: для каждой конверсии строится путь (visits), назначаются роли first_touch, assist, last_touch; считается direct (last_touch) и assisted по каналам.
- **Direct override / fallback:** В коде есть классификация источника (source_classification, traffic_source, traffic_platform) и состояние атрибуции (paid_attributed, direct, organic_search, referral, missing_expected_attribution) в `trafficSourceDetection.ts` и `attributionAnomalies` — для качества данных и отладки, не как отдельная «модель» атрибуции. Явного «direct override» (например, всегда приписывать direct при отсутствии UTM) в отчётах не используется; при отсутствии данных канал может попадать в «direct» или «unknown» по классификации.

**Кратко:** используется multi-touch (first / assist / last) поверх истории визитов; first/last touch считаются и отображаются в отчётах и дашборде.

---

## SECTION 13 — DATA LOSS RISKS

1. **Потеря click_id:** Если пользователь не заходит через redirect-ссылку (напрямую ввёл URL или пришёл без bqcid), в visit и конверсии click_id не попадёт. Если фронт не передаёт click_id при вызове POST /api/tracking/conversion, в конверсии он будет пустым.
2. **Потеря visitor_id:** В Safari/incognito cookie могут блокироваться — тогда при каждом визите будет новый visitor_id, цепочка визитов и атрибуция по одному пользователю разорвутся. localStorage дублирует visitor_id, но при очистке хранилища или смене устройства идентичность теряется.
3. **Потеря UTM:** Если пользователь пришёл по ссылке без UTM или редирект не передал UTM в destination URL, визит будет с пустыми utm_*. При прямом заходе UTM по определению нет.
4. **Потеря связи визит → покупка:** Если конверсия отправляется без visitor_id (или с другим visitor_id, чем у визитов), связь визит→покупка в логике assisted attribution не построится (в коде при отсутствии visitor_id путь пустой).
5. **Session_id не в конверсиях:** В conversion_events нет session_id; для анализа по сессиям или дедупликации по сессии данных нет.
6. **POST /api/tracking/source не используется трекером:** Трекер шлёт только GET pixel. Если в будущем перейти на POST, нужно убедиться, что POST-роут тоже передаёт session_id, fbp, fbc (сейчас в POST-роуте эти поля не читаются и не вставляются в visit_source_events).

---

## SECTION 14 — REPORT FORMAT (итог)

### 1. Pixel tracking status

**Реализовано:** Сбор visitor_id, session_id, landing_url, referrer, utm_*, fbclid, gclid, ttclid, yclid, fbp, fbc, touch_type, click_id (bqcid), visit_id. Отправка каждым page load через GET-пиксель. Запись в visit_source_events с классификацией источника и детекцией traffic_source/traffic_platform.  
**Ограничения:** Отправка только GET (image beacon); POST /source не вызывается трекером; при блокировке cookie (Safari/incognito) возможна потеря постоянного visitor_id.

### 2. Identity tracking status

**Реализовано:** visitor_id в cookie (1 год) + дубликат в localStorage и window; session_id в sessionStorage; оба передаются в пиксель и сохраняются в visit_source_events.  
**Ограничения:** Нет отдельной таблицы users/sessions; session_id не сохраняется в conversion_events.

### 3. Click tracking status

**Реализовано:** Генерация bqcid при редиректе /r/[token], сохранение в redirect_click_events, передача bqcid и UTM в destination URL; пиксель передаёт bqcid как click_id в visit_source_events; API конверсий принимает и сохраняет click_id.  
**Ограничения:** Click_id в конверсии только если вызывающая сторона его передаёт; при прямых заходах без редиректа click_id в визитах пустой.

### 4. Conversion tracking status

**Реализовано:** POST /api/tracking/conversion для registration и purchase; сохранение visitor_id, click_id, user_external_id, utm_*, value, currency, fbp, fbc, traffic_source/traffic_platform; связь с визитами по visitor_id и времени.  
**Ограничения:** Нет session_id в конверсиях; связь визит→покупка только по visitor_id (при его отсутствии в конверсии путь не строится).

### 5. Attribution model status

**Реализовано:** First / last / assist на основе истории визитов (visit_source_events) по visitor_id; расчёт first_touch, last_touch, assisted по каналам; отображение в дашборде и отладчике атрибуции.  
**Ограничения:** Нет отдельных колонок first_touch_source/last_touch_source в БД — всё выводится расчётом из визитов.

---

## Missing pieces (что доработать)

1. **session_id в конверсиях:** Добавить приём и сохранение session_id в POST /api/tracking/conversion и в таблице conversion_events для сессионного анализа и дедупликации.
2. **POST /api/tracking/source:** Если планируется использовать POST для визитов, добавить в роут чтение и запись session_id, fbp, fbc при insert в visit_source_events (как в pixel-роуте).
3. **Документация для интеграции конверсий:** Явно описать, что для связи конверсии с визитами и путём обязательно передавать visitor_id (и по возможности click_id) с того же фронта/бэкенда, где работает пиксель.
4. **Защита от потери visitor_id:** Рассмотреть fallback (например, fingerprint или server-side session) при отсутствии cookie для уменьшения разрывов цепочки в Safari/incognito (с учётом приватности).
5. **RLS и проверка доступа:** В документации отмечено отсутствие RLS на visit_source_events и проверки доступа к project в status API — при мультитенантности стоит добавить.
6. **Колонка yclid:** В миграции visit_source_events колонка yclid присутствует; замечание из предыдущих аудитов снято.

---

*Конец отчёта. Код не изменялся.*
