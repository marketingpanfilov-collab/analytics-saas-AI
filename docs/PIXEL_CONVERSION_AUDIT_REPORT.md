# Технический аудит и тестирование: пиксель и конверсии BoardIQ

Дата: 2025-03-06  
Цель: проверить цепочку **visit → visitor_id → conversion_events → аналитика** и выявить точки обрыва атрибуции.  
Рефакторинг не выполнялся — только аудит и фиксация.

---

## SECTION 1 — FILE AUDIT

| Файл | Назначение |
|------|------------|
| **public/tracker.js** | Клиентский пиксель: генерация и сохранение visitor_id (cookie `as_visitor`, `window.boardiqVisitorId`, localStorage `boardiq_visitor_id`), session_id (sessionStorage), сбор landing_url, referrer, utm_*, gclid, fbclid, yclid, ttclid, fbp/fbc из cookie. Отправка визита через **GET** image beacon на `/api/tracking/source/pixel`. |
| **app/api/tracking/source/route.ts** | **POST** /api/tracking/source — приём визитов в JSON (visitor_id, site_id, landing_url, referrer, utm_*, click id, touch_type). Вставка в `visit_source_events`, классификация источника. CORS включён. Сейчас **не используется трекером** (трекер шлёт только в pixel GET). |
| **app/api/tracking/source/pixel/route.ts** | **GET** /api/tracking/source/pixel — image beacon: те же поля через query params, вставка в `visit_source_events`, ответ 1×1 GIF. Используется трекером. |
| **app/api/tracking/source/status/route.ts** | **GET** /api/tracking/source/status?site_id=xxx — проверка наличия событий по site_id, возврат последнего события. Проверки доступа к проекту нет. |
| **app/api/tracking/conversion/route.ts** | **POST** /api/tracking/conversion — приём конверсий (registration, purchase). Валидация project_id (UUID), event_name, visitor_id. Вставка в `conversion_events`. CORS включён. |
| **app/lib/sourceClassification.ts** | Классификация источника визита: paid, organic_search, organic_social, referral, direct, unknown. Используется в source/pixel и source POST. |
| **app/app/(with-sidebar)/pixels/PixelsPageClient.tsx** | UI страницы BQ Pixel: hero, статусы (Pixel script, Visit tracking, Conversion tracking), блок «что собирается автоматически», предупреждение для разработчиков, блок про покупку, зачем visitor_id/user id, степпер, вкладки с кодом (установка, registration, purchase, helper), статус трекера, чеклист. |
| **app/app/(with-sidebar)/pixels/page.tsx** | Обёртка: Suspense + PixelsPageClient, force-dynamic. |

---

## SECTION 2 — PIXEL BEHAVIOR TEST

Проверка по коду **public/tracker.js**.

| Проверка | Статус | Комментарий |
|----------|--------|-------------|
| 1) Генерируется visitor_id | ✅ | Формат `v_` + random + `_` + timestamp (36), длина ≥ 10. |
| 2) visitor_id сохраняется в window.boardiqVisitorId | ✅ | Стр. 81: `window.boardiqVisitorId = visitorId`. |
| 2) visitor_id сохраняется в localStorage boardiq_visitor_id | ✅ | Стр. 82: `localStorage.setItem("boardiq_visitor_id", visitorId)`. |
| 3) Генерируется session_id | ✅ | Формат `s_` + random + `_` + timestamp, в getSessionId(). |
| 4) session_id в sessionStorage | ✅ | Ключ `boardiq_session_id`. |
| 5) Пиксель собирает page_url, referrer, utm_*, fbclid, gclid, ttclid, yclid, _fbp, _fbc | ✅ | page_url = `window.location.href` (в payload как landing_url). referrer, utm_*, gclid, fbclid, yclid, ttclid из URL; _fbp, _fbc из cookie. |
| 6) Данные отправляются в POST /api/tracking/source | ❌ | **Фактически отправка идёт в GET /api/tracking/source/pixel** (image beacon), не в POST. POST route существует, но трекер его не вызывает. |
| 7) Статус ответа API = 200 | ✅ | Pixel endpoint всегда возвращает 200 и 1×1 GIF (даже при ошибке вставки в БД). |

**Полный payload, формируемый в трекере (объект payload):**

```json
{
  "visitor_id": "v_xxx_yyy",
  "site_id": "<data-project-id или site_id из URL>",
  "session_id": "s_xxx_yyy",
  "landing_url": "https://...",
  "referrer": "",
  "utm_source": "",
  "utm_medium": "",
  "utm_campaign": "",
  "utm_content": "",
  "utm_term": "",
  "gclid": "",
  "fbclid": "",
  "yclid": "",
  "ttclid": "",
  "fbp": "",
  "fbc": "",
  "touch_type": "first | last"
}
```

**Что реально уходит в pixel (query params):**  
В URL передаются только: `visitor_id`, `site_id`, `landing_url`, `referrer`, `touch_type`, `_ts`, и при наличии — `utm_source`, `utm_medium`, `utm_campaign`, `utm_content`, `utm_term`, `gclid`, `fbclid`, `yclid`, `ttclid`.  
**session_id, fbp, fbc в pixel URL не добавляются** — в бэкенд для визитов они не попадают.

---

## SECTION 3 — DATABASE SCHEMA AUDIT

### visit_source_events

**Текущие колонки (миграция 20250309000000):**  
id, visitor_id, **site_id**, **landing_url**, referrer, utm_source, utm_medium, utm_campaign, utm_content, utm_term, gclid, fbclid, yclid, ttclid, source_classification, touch_type, created_at.

| Ожидаемая по аудиту | Есть в БД | Примечание |
|---------------------|-----------|------------|
| project_id | ❌ (есть site_id) | Семантически project_id = site_id (uuid проекта). Имя колонки — site_id. |
| visitor_id | ✅ | |
| session_id | ❌ | В трекере есть, в pixel URL не передаётся, в таблице колонки нет. |
| page_url | ❌ (есть landing_url) | landing_url = полный URL страницы (аналог page_url). |
| referrer | ✅ | |
| utm_source … utm_term | ✅ | |
| fbclid, gclid, ttclid, yclid | ✅ | |
| fbc, fbp | ❌ | В трекере читаются, в pixel не передаются, в таблице колонок нет. |
| created_at | ✅ | |

### conversion_events

**Текущие колонки (миграция 20250318000000):**  
id, project_id, source, event_name, event_time, external_event_id, user_external_id, visitor_id, click_id, fbp, fbc, utm_source, utm_medium, utm_campaign, utm_content, utm_term, value, currency, metadata, created_at.

| Ожидаемая по аудиту | Есть в БД | Примечание |
|---------------------|-----------|------------|
| project_id | ✅ | |
| visitor_id | ✅ | |
| session_id | ❌ | Нет колонки. |
| event_name | ✅ | |
| event_time | ✅ | |
| user_external_id | ✅ | |
| external_event_id | ✅ | Может использоваться как order_id. |
| order_id | ❌ | Отдельной колонки нет; можно хранить в external_event_id или metadata. |
| email | ❌ | Нет колонки; можно в metadata. |
| phone | ❌ | Нет колонки; можно в metadata. |
| value, currency | ✅ | |
| click_id, fbp, fbc | ✅ | |
| utm_* | ✅ | |
| metadata | ✅ | |
| created_at | ✅ | |

### SQL миграции (рекомендуемые, не применены)

Ниже — только предложенные изменения. **Ничего автоматически не применено.**

**1) visit_source_events — добавить session_id, fbp, fbc (если нужно сохранять их на уровне визита):**

```sql
-- Опционально: если нужно писать session_id и fbp/fbc из пикселя
ALTER TABLE public.visit_source_events
  ADD COLUMN IF NOT EXISTS session_id text,
  ADD COLUMN IF NOT EXISTS fbp text,
  ADD COLUMN IF NOT EXISTS fbc text;

CREATE INDEX IF NOT EXISTS idx_visit_source_events_session_id
  ON public.visit_source_events(session_id);
```

**Важно:** текущий трекер **не передаёт** session_id, fbp, fbc в pixel URL, поэтому после миграции их нужно начать добавлять в pixel/route (и в POST source) и в tracker.js (добавить в params).

**2) conversion_events — добавить session_id (опционально), order_id / email / phone (опционально):**

```sql
-- Опционально: явные колонки вместо только metadata
ALTER TABLE public.conversion_events
  ADD COLUMN IF NOT EXISTS session_id text,
  ADD COLUMN IF NOT EXISTS order_id text,
  ADD COLUMN IF NOT EXISTS email text,
  ADD COLUMN IF NOT EXISTS phone text;

CREATE INDEX IF NOT EXISTS idx_conversion_events_order_id
  ON public.conversion_events(order_id);
```

Сейчас order_id можно передавать в `external_event_id`, email/phone — в `metadata`. Миграция нужна только если нужны отдельные колонки и индексы.

---

## SECTION 4 — API ROUTE TEST

### POST /api/tracking/source

- **Обязательные поля:** visitor_id, site_id. Остальные опциональны.
- **Валидация:** visitor_id/site_id до 64 символов, строки обрезаются по maxLen.
- **Ответ при успехе:** 201, `{ "success": true }`.
- **При ошибке вставки:** 500, `{ "success": false, "error": "..." }`.
- **При отсутствии visitor_id или site_id:** 400.

Трекер **не вызывает** этот endpoint; используется только GET pixel.

### POST /api/tracking/conversion

- **Обязательные поля:** project_id (валидный UUID), event_name (registration | purchase), visitor_id.
- **Валидация:** project_id — строгий UUID; event_name — только registration или purchase; visitor_id до 256 символов.
- **Ответ при успехе:** 201, `{ "success": true }`.
- **Поля, которые пишутся:** project_id, source, event_name, event_time, external_event_id, user_external_id, visitor_id, click_id, fbp, fbc, utm_*, value, currency, metadata. order_id как колонки нет — передавать в external_event_id или metadata.

**Тестовые запросы (подставить реальный UUID проекта):**

**Registration:**

```json
POST /api/tracking/conversion
{
  "project_id": "550e8400-e29b-41d4-a716-446655440000",
  "event_name": "registration",
  "visitor_id": "test_visitor",
  "user_external_id": "user_test"
}
```

Ожидание: 201. Запись в conversion_events с event_name=registration, visitor_id=test_visitor.

**Purchase (в API нет поля order_id — используется external_event_id):**

```json
POST /api/tracking/conversion
{
  "project_id": "550e8400-e29b-41d4-a716-446655440000",
  "event_name": "purchase",
  "visitor_id": "test_visitor",
  "user_external_id": "user_test",
  "external_event_id": "order_test",
  "value": 120,
  "currency": "USD"
}
```

Ожидание: 201. Запись в conversion_events с event_name=purchase, value=120, currency=USD.  
Проверка: выборка из conversion_events по project_id и visitor_id — должны появиться обе записи.

---

## SECTION 5 — DATA FLOW TEST

Цепочка:

1. **Визит** — трекер на странице с тем же site_id (project_id) отправляет pixel GET → в visit_source_events пишется строка с visitor_id (и site_id).
2. **Registration** — сайт вызывает POST /api/tracking/conversion с тем же visitor_id и project_id → в conversion_events запись с event_name=registration.
3. **Purchase** — сайт вызывает POST /api/tracking/conversion с тем же visitor_id, project_id, value, currency → в conversion_events запись с event_name=purchase.

Связь по visitor_id: в visit_source_events и conversion_events один и тот же visitor_id. Для расчёта CAC/ROAS нужно джойнить conversion_events с visit_source_events по (visitor_id, project_id/site_id).  
Проверка: один и тот же visitor_id (например test_visitor) — одна запись в visit_source_events и две в conversion_events (registration + purchase). Джойн по visitor_id корректен при наличии индексов (idx_conversion_events_visitor_id, idx_visit_source_events_visitor_id).

---

## SECTION 6 — PIXEL PAGE UI AUDIT

| Элемент | Статус | Комментарий |
|---------|--------|-------------|
| Hero блок | ✅ | Заголовок «BQ Pixel», подзаголовок про визиты/регистрации/покупки и CAC/ROAS. |
| Статус Pixel script | ✅ | «Доступен» при наличии origin и project_id. |
| Статус Visit tracking | ✅ | «Active» / «Ожидание событий» по данным GET /api/tracking/source/status. |
| Статус Conversion tracking | ✅ | «API готов». |
| Блок «Что обязательно должны сделать разработчики» | ✅ | Текст и списки обязательных/желательных полей. |
| Вкладка Pixel install | ✅ | Сниппет с `data-project-id`, соответствует трекеру (поддержка data-project-id есть). |
| Вкладка Registration event | ✅ | sendRegistrationEvent + вызов после регистрации; project_id, event_name, visitor_id, user_external_id, source, event_time — соответствуют API. |
| Вкладка Purchase event | ✅ | sendPurchaseEvent с external_event_id (orderId), value, currency — API принимает external_event_id, не order_id; код корректен. |
| Чеклист | ✅ | Пункты про пиксель, визиты, visitor_id, registration, purchase, user_external_id, value и currency. |

Код на странице соответствует реальному API (POST /api/tracking/conversion, поля project_id, event_name, visitor_id, user_external_id, external_event_id, value, currency, source, event_time, metadata).

---

## SECTION 7 — BREAKPOINT ANALYSIS

Точки, где может рваться атрибуция:

1. **visitor_id не сохраняется**  
   - Очистка cookie/localStorage пользователем или инкогнито без сохранения в cookie → новый visitor_id, связь с прошлыми визитами теряется.  
   - Блокировка третьих сторон / cookie — cookie as_visitor first-party, но при смене домена или жёсткой политике visitor_id может теряться.

2. **session_id теряется**  
   - session_id не передаётся в pixel и не пишется в visit_source_events → в БД его нет, аналитика по сессиям по нашей таблице невозможна.  
   - При переходе на новый домен/поддомен sessionStorage не общий → «новая сессия».

3. **Conversion не передаёт visitor_id**  
   - Если разработчик клиента не передаёт visitor_id в POST /api/tracking/conversion, конверсия не свяжется с визитом. API возвращает 400 при отсутствии visitor_id.

4. **API не сохраняет UTM для визитов**  
   - UTM сохраняются: pixel и POST source пишут utm_* в visit_source_events. Для конверсий UTM опционально передаются в теле и пишутся в conversion_events.

5. **Данные не совпадают**  
   - site_id в визитах должен совпадать с project_id в конверсиях (один и тот же UUID). Разные значения → джойн не сойдётся.  
   - Опечатка или разный формат visitor_id на стороне клиента (пробелы, кодировка) → разрыв связи.

6. **Пиксель отправляет только GET pixel**  
   - session_id, fbp, fbc в visit_source_events не попадают — они не добавлены в query pixel и (в текущей схеме) в таблицу.

7. **Статус API без проверки доступа**  
   - GET /api/tracking/source/status?site_id=xxx не проверяет, что пользователь имеет доступ к проекту → утечка факта «есть события» по любому project_id.

---

## SECTION 8 — SECURITY CHECK

| Проверка | Результат |
|----------|-----------|
| Валидация project_id | В POST /api/tracking/conversion — да: обязателен и должен быть валидным UUID. В GET /api/tracking/source/status — site_id не валидируется как UUID и не проверяется принадлежность проекту. |
| RLS для таблиц | **Нет.** На visit_source_events и conversion_events RLS не включён. Доступ только через service role (API). Чтение из приложения (дашборд) должно идти через API с проверкой прав проекта. |
| Доступ к API | POST /api/tracking/source и POST /api/tracking/conversion доступны без авторизации (CORS *). Это ожидаемо для приёма событий с внешних сайтов. |
| Возможность спама events | Ограничений нет: нет rate limit, нет проверки подписи/токена. Любой может слать произвольные объёмы визитов и конверсий на любой project_id. Риск: накрутка и переполнение БД. |

---

## SECTION 9 — PERFORMANCE CHECK

| Проверка | Результат |
|----------|-----------|
| Индексы visit_source_events | visitor_id, site_id, created_at, (visitor_id, site_id). |
| Индексы conversion_events | visitor_id, project_id, event_time. |
| Размер payload | Pixel: URL ограничен браузером (~2K и выше); строки в API обрезаются (landing_url 2048, utm 256 и т.д.). |
| Частота событий | Один визит на загрузку страницы; конверсии по факту. Ограничений по частоте нет — при большом трафике возможна высокая нагрузка на вставки. |

---

## SECTION 10 — FINAL REPORT

### 1) Список проверенных файлов

- public/tracker.js  
- app/api/tracking/source/route.ts  
- app/api/tracking/source/pixel/route.ts  
- app/api/tracking/source/status/route.ts  
- app/api/tracking/conversion/route.ts  
- app/lib/sourceClassification.ts  
- app/app/(with-sidebar)/pixels/PixelsPageClient.tsx  
- app/app/(with-sidebar)/pixels/page.tsx  
- supabase/migrations/20250309000000_visit_source_events.sql  
- supabase/migrations/20250318000000_conversion_events_visitor_id.sql  

### 2) Схема таблиц (кратко)

**visit_source_events:**  
id, visitor_id, site_id, landing_url, referrer, utm_source, utm_medium, utm_campaign, utm_content, utm_term, gclid, fbclid, yclid, ttclid, source_classification, touch_type, created_at.  
Нет: session_id, fbp, fbc; колонка «project_id» отсутствует (используется site_id).

**conversion_events:**  
id, project_id, source, event_name, event_time, external_event_id, user_external_id, visitor_id, click_id, fbp, fbc, utm_*, value, currency, metadata, created_at.  
Нет: session_id, order_id, email, phone как отдельных колонок (order_id можно в external_event_id, email/phone в metadata).

### 3) Найденные проблемы

1. Трекер отправляет визиты только в **GET /api/tracking/source/pixel**, не в POST /api/tracking/source.  
2. В pixel URL и в visit_source_events **не передаются/не сохраняются** session_id, fbp, fbc.  
3. В visit_source_events нет колонок session_id, fbp, fbc.  
4. В conversion_events нет колонок session_id, order_id, email, phone (частично компенсируется external_event_id и metadata).  
5. GET /api/tracking/source/status не проверяет доступ пользователя к проекту (site_id).  
6. Нет RLS на visit_source_events и conversion_events (доступ только через API с service role).  
7. Нет защиты от спама (rate limit / лимиты на объём событий).

### 4) SQL миграции (если нужны)

См. **SECTION 3** — предложены (но не применены) миграции для добавления в visit_source_events: session_id, fbp, fbc; в conversion_events: session_id, order_id, email, phone. Для работы session_id/fbp/fbc в визитах дополнительно нужно передавать их в pixel (и в POST source) и обрабатывать в route.

### 5) Рекомендации

- Документировать или изменить тест: «данные отправляются в GET /api/tracking/source/pixel», а не в POST /api/tracking/source.  
- Либо добавить в трекер отправку визитов также через POST /api/tracking/source (с session_id, fbp, fbc) для полноты данных, либо оставить только pixel и добавить в pixel передачу session_id, fbp, fbc и миграцию под них.  
- Добавить проверку доступа к проекту в GET /api/tracking/source/status (по текущему пользователю и project_id/site_id).  
- Рассмотреть rate limiting для POST /api/tracking/source и POST /api/tracking/conversion.  
- Для аналитики: джойн conversion_events с visit_source_events по (visitor_id, project_id/site_id) — индексы уже есть.
