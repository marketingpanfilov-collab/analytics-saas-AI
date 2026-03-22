# Аудит: источник привлечения для /app/ltv и фильтр Acquisition channel

**Дата:** 2025-03-06  
**Область:** определение acquisition source для доски LTV и возможность фильтра «Источник привлечения».  
**Ограничение:** только исследование текущей логики и отчёт; код не менялся.

---

## РАЗДЕЛ 1. Карта таблиц и полей, участвующих в acquisition source

### 1.1. redirect_click_events

| Поле | Назначение |
|------|------------|
| id | UUID |
| project_id | Проект |
| redirect_link_id | Ссылка UTM Builder |
| **bq_click_id** | Уникальный ID клика (генерируется в /r/[token], передаётся в URL как bqcid → в конверсиях как click_id) |
| destination_url, full_url | URL перехода |
| utm_source, utm_medium, utm_campaign, utm_content, utm_term | UTM из ссылки/URL |
| fbclid, gclid, ttclid, yclid | Click ID рекламных систем |
| referrer, user_agent, ip | Запрос |
| fbp, fbc | Facebook cookie |
| **traffic_source** | Определённый источник: meta, google, tiktok, yandex или из utm_source (заполняется в redirect handler через detectTrafficSource) |
| **traffic_platform** | Платформа: facebook_ads, google_ads, tiktok_ads, yandex_ads |
| campaign_intent | acquisition / retention (из ссылки или параметра) |
| utm_id | Опционально (TikTok и др.) |
| created_at | Время клика |

**Нет:** visitor_id. Связь с пользователем только через то, что на лендинге пиксель передаёт bqcid в конверсию как click_id.

### 1.2. visit_source_events

| Поле | Назначение |
|------|------------|
| id | UUID |
| **visitor_id** | Идентификатор посетителя (обязателен) |
| **site_id** | В коде используется как project_id (то же UUID проекта) |
| landing_url, referrer | Страница входа, реферер |
| utm_source, utm_medium, utm_campaign, utm_content, utm_term | UTM с лендинга |
| gclid, fbclid, yclid, ttclid | Click ID |
| **source_classification** | paid | organic_search | organic_social | referral | direct | unknown (из classifySource) |
| **touch_type** | 'first' \| 'last' (передаётся пикселем) |
| **click_id** | bqcid из URL; связь с redirect_click_events.bq_click_id |
| visit_id | bqvid (визит) |
| session_id, fbp, fbc | Сессия и Facebook cookie |
| **traffic_source**, **traffic_platform** | Как в redirect (из detectTrafficSource по UTM/click IDs/referrer) |
| campaign_intent | Из URL/пикселя (миграция 20250601) |
| created_at | Время визита |

### 1.3. conversion_events

| Поле | Назначение |
|------|------------|
| id, project_id, event_name, event_time, created_at | Событие |
| **user_external_id** | Внешний ID пользователя (CRM/backend) |
| **visitor_id** | Идентификатор посетителя (пиксель) |
| **click_id** | bqcid с лендинга; связь с redirect_click_events.bq_click_id |
| source | Канал приёма события (например "pixel") |
| **traffic_source**, **traffic_platform** | Заполняются при инжесте только из utm_source и referrer (в POST /api/tracking/conversion fbclid/gclid/… в detectTrafficSource не передаются — null). Из redirect по click_id не копируются. |
| utm_source, utm_medium, utm_campaign, … | UTM из тела запроса |
| value, currency | Сумма, валюта |
| campaign_intent | Из тела или из redirect_click_events по click_id (только это поле подтягивается по клику) |
| session_id | Сессия |

LTV API сейчас выбирает из conversion_events только: user_external_id, visitor_id, event_time, value, campaign_intent. Полей click_id, traffic_source, traffic_platform, source в запросах LTV нет.

### 1.4. campaigns

| Поле | Назначение |
|------|------------|
| id | UUID кампании |
| project_id | Проект |
| meta_campaign_id, external_campaign_id | Внешние ID (Meta, др.) |
| platform | Платформа рекламы |

Используются для retention spend (связка redirect_click_events → utm_campaign → campaigns → daily_ad_metrics_campaign). Для определения acquisition source на уровне «канал привлечения пользователя» в LTV не участвуют.

### 1.5. daily_ad_metrics_campaign

Расход по кампаниям; в контексте acquisition source для LTV используется только для retention spend, не для атрибуции канала.

---

## РАЗДЕЛ 2. Реальные цепочки связывания user ↔ source

### Вариант А: conversion_events.click_id → redirect_click_events.bq_click_id

- **Существует:** да. В БД: conversion_events.click_id, redirect_click_events.bq_click_id; индекс по click_id.
- **Как работает:** конверсия приходит с click_id (bqcid с лендинга). По нему можно взять строку клика и её traffic_source / traffic_platform.
- **Надёжность:** высокая, когда click_id заполнен. Но доля конверсий с click_id может быть небольшой (прямые заходы, пиксель без bqcid, старые события). В проекте это явно отслеживается: conversion_missing_click_id_rate, conversions_with_click_id_rate (attributionAnomalies).
- **Ограничение:** LTV не читает click_id и не джойнит redirect_click_events.

### Вариант Б: conversion_events.visitor_id → visit_source_events.visitor_id

- **Существует:** да. visit_source_events пишутся с site_id = project_id; в dashboard (KPI, source-options) используется .eq("site_id", projectId).
- **Как работает:** по visitor_id конверсии можно взять визиты этого посетителя и выбрать источник (например первый визит по created_at или touch_type = 'first') — source_classification или traffic_source.
- **Надёжность:** средняя. Работает только для конверсий с заполненным visitor_id. В LTV пользователь может быть определён только по user_external_id (без visitor_id) — тогда эта цепочка для него недоступна.
- **Ограничение:** LTV не обращается к visit_source_events; в KPI/source-options используется «последний визит до конверсии», а не первый (first touch) для определения acquisition.

### Вариант В: conversion_events.traffic_source / traffic_platform на событии конверсии

- **Существует:** да, поля есть и заполняются при инжесте.
- **Как заполняются:** в POST /api/tracking/conversion вызывается detectTrafficSource только с utm_source и referrer (остальные параметры передаются как null). То есть это «что прислал пиксель» (UTM/реферер), а не копия из redirect по click_id.
- **Надёжность:** низкая для «канала привлечения»: при наличии click_id источник клика (redirect) в conversion_events не дублируется; traffic_source может быть пустым, если пиксель не передал UTM/реферер.
- **Ограничение:** LTV эти поля не выбирает и не использует.

### Вариант Г: visit_source_events.click_id → redirect_click_events.bq_click_id

- **Существует:** да. visit_source_events.click_id хранит bqcid; по нему можно получить redirect_click_events и traffic_source.
- **Роль:** дополнительная связь «визит → клик → канал». Для LTV важнее связь конверсия → клик или конверсия → визит; эта связь визит→клик в LTV не используется.

---

## РАЗДЕЛ 3. Существующая логика source attribution и пригодность для /app/ltv

### 3.1. Dashboard: source-options и KPI

- **source-options** (`/api/dashboard/source-options`): строит список «источников» для фильтра дашборда: платформы из включённых ad accounts (meta, google, …) + классы из visit_source_events (direct, organic_search, referral). Для классов дополнительно смотрит conversion_events (traffic_source, source) и visit_source_events по visitor_id конверсий; при отсутствии источника помечает как "direct".
- **KPI** (`/api/dashboard/kpi`): конверсии за период; для каждой конверсии определяет _platform_source (normalizePlatformSource из traffic_source/source) и _source_class (последний визит по visitor_id с created_at ≤ conversion.created_at). Фильтр sources отсекает конверсии по платформе или классу.
- **Общее:** это last-touch по визиту + платформа с конверсии, привязано к событию конверсии, а не к «пользователю LTV» и не к первому касанию (acquisition).

### 3.2. Нормализация и детекция источника

- **normalizePlatformSource** (dashboard/kpi, source-options): только meta, google, tiktok, yandex; остальное не считается платформой.
- **detectTrafficSource** (trafficSourceDetection.ts): приоритет fbclid → gclid → ttclid → yclid → utm_source → referrer; выдаёт traffic_source и traffic_platform.
- **classifySource** (sourceClassification.ts): paid, organic_search, organic_social, referral, direct, unknown по UTM и click IDs.

Эту логику можно переиспользовать для определения канала в LTV, но нужно явно решить: по какому событию/таблице считаем acquisition (первый клик, первый визит, первая покупка) и откуда брать значения (redirect по click_id, первый визит по visitor_id, или traffic_source на конверсии).

### 3.3. Attribution debugger и journey

- **attributionDebugger**: собирает цепочки по click_id (redirect → visits → regs → purchases); использует traffic_source с redirect_click_events и conversion_events. Показывает качество связки (click_id vs visitor_id vs user_external_id).
- **attributionJourney**: first_touch_source / first_touch_platform считаются по кликам в цепочке (click → visit → reg → purchase). Подходит для понимания first touch в рамках цепочки, но не для массового «acquisition channel по всем пользователям LTV» без доработок.

Для LTV важно: сейчас нет ни одного места, где по всем пользователям (user_external_id || visitor_id) считается один acquisition source и по нему фильтруются данные.

### 3.4. Вывод по переиспользованию

- Переиспользовать можно: normalizePlatformSource, detectTrafficSource, classifySource, а также существующие цепочки click_id → redirect и visitor_id → visit_source_events.
- Не подходит «как есть»: в LTV нет ни запроса click_id/traffic_source из conversion_events, ни разрешения acquisition source на пользователя (первая покупка → click или первый визит), ни фильтрации по каналу. То есть логику атрибуции нужно подключать к LTV отдельно и явно определять, что считаем acquisition source.

---

## РАЗДЕЛ 4. Главные технические риски

1. **В LTV не выбираются поля источника**  
   Запросы к conversion_events в /api/ltv не включают click_id, traffic_source, traffic_platform, source. Даже при наличии данных в БД текущий LTV не может по ним фильтровать.

2. **Часть конверсий без click_id**  
   Многие покупки могут идти без bqcid (прямой заход, другой вход, пиксель не передал bqcid). Тогда цепочка «конверсия → redirect_click_events» не строится. В коде это явно учитывается (conversion_missing_click_id_rate). Фильтр по каналу только по click_id оставит большую долю пользователей «без канала».

3. **Пользователи только по user_external_id**  
   User key в LTV = user_external_id || visitor_id. Если есть только user_external_id (без visitor_id), связать такого пользователя с visit_source_events нельзя. Acquisition по «первому визиту» для них недоступен; остаётся только click_id или traffic_source на самой конверсии (если будут подставляться в LTV).

4. **traffic_source на конверсии не из redirect**  
   При инжесте конверсии traffic_source не копируется из redirect_click_events по click_id; он считается только по utm_source и referrer из тела запроса. Поэтому «источник клика» и «источник на конверсии» могут расходиться; для acquisition по клику нужен джойн по click_id.

5. **Нет единого определения acquisition**  
   В системе есть и first touch (attribution journey по кликам), и last touch (KPI по визитам). Для фильтра «Источник привлечения» в LTV нужно зафиксировать: first click (redirect), first visit (visit_source_events), или источник первой покупки (conversion_events) — и везде использовать одно определение.

6. **visit_source_events и проект**  
   Привязка к проекту через site_id; в коде site_id = project_id. Нужно гарантировать, что пиксель всегда передаёт site_id = project_id, иначе визиты «чужого» проекта попадут в выборку.

7. **First touch по визитам**  
   visit_source_events имеют touch_type ('first' | 'last'), но для надёжного first touch по visitor_id лучше явно брать MIN(created_at) по visitor_id + site_id, а не полагаться только на то, что всегда пишется ровно одна запись с touch_type = 'first'.

---

## РАЗДЕЛ 5. Прямой вывод

### Можно ли уже сейчас вернуть фильтр Acquisition channel в /app/ltv?

**Нет, в текущем виде — нельзя.**  
LTV не читает ни click_id, ни traffic_source, ни visit_source_events и не вычисляет acquisition source на уровне пользователя. Фильтр по каналу при текущей реализации не к чему привязать; возврат только UI без бэкенда даст снова «мёртвый» фильтр.

### Если бы делали фильтр — на какой логике его строить?

Рекомендуемая схема (после доработок):

1. **Определение пользователя LTV** — без изменений: user_external_id || visitor_id.
2. **Определение acquisition source на пользователя** (одна из двух стратегий):
   - **Предпочтительно (first click):** для каждого пользователя взять событие первой покупки (как сейчас считается в LTV). Если у этого события есть click_id — взять traffic_source из redirect_click_events по bq_click_id = click_id. Иначе, если есть visitor_id — взять первый визит (MIN(created_at)) в visit_source_events по visitor_id и site_id = project_id и использовать traffic_source или source_classification. Иначе — взять traffic_source с самой конверсии первой покупки (или пометить как "direct"/"unknown").
   - **Альтернатива (first visit):** для каждого visitor_id взять первый визит в visit_source_events; для пользователей только с user_external_id без visitor_id — либо не показывать в разбивке по каналу, либо fallback на conversion_events.traffic_source первой покупки, если его начнут заполнять/подтягивать.
3. **Фильтр:** передавать в API LTV параметр channel (например meta, google, direct, organic_search, referral). В API — оставлять в выборке только пользователей, у которых выбранный acquisition source совпадает с channel. Остальная логика LTV (first/repeat, когорты, retention) считается уже по отфильтрованному множеству.

Таблицы и поля для такой логики уже есть; не хватает их использования в /api/ltv и единого определения «acquisition source».

### Чего не хватает для безопасного фильтра

1. **В /api/ltv:**  
   - Читать для покупок (как минимум для событий, используемых как «первая покупка» по пользователю) поля: click_id, traffic_source (и при необходимости visitor_id уже читается).  
   - Для каждого пользователя (user key) вычислить один acquisition source по правилу выше (click_id → redirect; иначе visitor_id → first visit; иначе conversion.traffic_source или unknown).  
   - Принимать параметр channel и фильтровать по этому полю (только пользователи с данным acquisition source).  
   - Опционально: при инжесте конверсии при наличии click_id подтягивать traffic_source из redirect_click_events и писать в conversion_events, чтобы даже без джойна в LTV иметь источник на событии.

2. **На фронте /app/ltv:**  
   - Список опций канала можно получать из существующего `/api/dashboard/source-options` (или аналога с теми же нормами meta/google/tiktok/direct/organic_search/referral).  
   - Передавать выбранный channel в запрос к LTV и строить UI по ответу с уже отфильтрованными данными.

3. **Семантика и покрытие:**  
   - Явно описать в коде и в UI: «acquisition source = источник первой покупки (first click или first visit, с fallback)».  
   - Учитывать, что у части пользователей канал будет "unknown"/"direct" (нет click_id и нет visitor_id или нет визитов). Показывать это в фильтре и в подсказках (например, «без атрибуции»).

### Самая надёжная связь

- **По качеству атрибуции:** click_id → redirect_click_events (traffic_source). Когда click_id есть, источник клика определён однозначно.  
- **По покрытию:** комбинация click_id (redirect) + visitor_id (first visit) + fallback на conversion_events.traffic_source. Иначе много пользователей останутся без канала.

### Как правильно считать «канал привлечения пользователя, после которого смотрим repeat purchases»

Иметь один канал на пользователя — канал, с которым связана **первая покупка** (как в LTV уже определяется «первая покупка» по глобальному MIN(event_time) по user key). Источник для этого события брать в порядке: (1) по click_id первой покупки — из redirect_click_events; (2) при отсутствии click_id — по visitor_id первой покупки из первого визита в visit_source_events (site_id = project_id); (3) иначе — traffic_source самой конверсии или "direct"/"unknown". Repeat purchases и все метрики LTV считать только по пользователям, попавшим в выбранный канал по этому правилу.

---

**Итог:** данные и цепочки для определения acquisition source в системе есть (redirect_click_events, visit_source_events, conversion_events с click_id и visitor_id), но /api/ltv их не использует. Без доработок бэкенда и чёткого определения acquisition source возвращать фильтр «Источник привлечения» в /app/ltv нельзя — фильтр будет мёртвым. После введения в LTV чтения click_id/traffic_source, разрешения acquisition source на пользователя и фильтрации по каналу — фильтр можно вернуть на описанной выше логике.

---

## Реализация (после внедрения)

### 1. Как определяется acquisition_source

Для каждого пользователя (user key = user_external_id \|\| visitor_id) берётся **первая покупка** (глобальный MIN(event_time)). Источник одной покупки:

1. **Шаг 1:** если у первой покупки есть `click_id` → поиск в `redirect_click_events` по `bq_click_id = click_id` → берётся `traffic_source`.
2. **Шаг 2:** иначе при наличии `visitor_id` → первый визит в `visit_source_events` (site_id = project_id, порядок по created_at) → `traffic_source` или при пустом — `source_classification`.
3. **Шаг 3:** иначе используется `conversion_events.traffic_source` первой покупки.
4. **Шаг 4:** иначе — `"unknown"`.

Значение нормализуется к одному из: meta, google, tiktok, yandex, direct, organic_search, referral, unknown.

### 2. Какие поля используются

- **conversion_events (первая покупка):** user_external_id, visitor_id, event_time, click_id, traffic_source.
- **redirect_click_events:** bq_click_id, traffic_source (при совпадении click_id).
- **visit_source_events:** visitor_id, site_id, traffic_source, source_classification, created_at (первый визит по visitor_id).

### 3. Как фильтр влияет на метрики

При переданном `acquisition_source` (не пусто и не "all") в расчёт попадают только пользователи с этим acquisition_source. Пересчитываются: users, first/repeat purchase counts, revenue (total, first, repeat, retention), repeat_purchase_rate, repeat_user_rate, доли выручки, lineData, cohortRows, cohortRevenueRows, cohortSizes, LTV, payback, unit economics. Retention campaign (campaign_intent=retention) не смешивается с фильтром — это отдельное измерение внутри отфильтрованного пула.

### 4. Fallback

- Нет click_id или клик не найден в redirect → переход к visitor_id / first visit.
- Нет visitor_id или визитов → conversion_events.traffic_source.
- Всё пусто → `"unknown"`. Отдельно "direct" не подставляется без явного источника.

### 5. Источники в UI

В фильтре: «Все источники» (all) + список из ответа API `acquisition_sources`. При отсутствии данных показываются запасные опции: meta, google, tiktok, yandex, direct, organic_search, referral, unknown. Подписи: Meta Ads, Google Ads, TikTok Ads, Yandex Ads, Direct, Organic Search, Referral, Unknown.
