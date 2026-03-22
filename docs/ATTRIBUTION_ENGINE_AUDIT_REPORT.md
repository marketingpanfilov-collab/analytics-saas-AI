# Аудит Attribution Engine

**Дата:** 2025-03-06  
**Задача:** Анализ системы атрибуции (как считается, first/last touch, multi-touch, источники данных, модели). Изменения в коде не вносились.

---

## SECTION 1 — DATA SOURCE

### Из каких таблиц берутся данные

| Таблица | Использование в атрибуции |
|--------|----------------------------|
| **visit_source_events** | Основная таблица истории визитов: по ней строится путь касаний до конверсии (visitor_id, created_at, traffic_source, traffic_platform, click_id, visit_id). Используется в assistedAttribution, topAttributionPaths, attributionHeatmap, revenueAttributionMap, attributionDebugger. |
| **conversion_events** | Конверсии (registration, purchase): связь с визитами по visitor_id и времени (created_at). Поля: visitor_id, click_id, user_external_id, value, currency, event_name, created_at, traffic_source. Используется везде, где нужен путь до конверсии или revenue. |
| **redirect_click_events** | Клики редиректа (bq_click_id): для цепочек Click → Visit → Registration → Purchase в Attribution Debugger и для journey (touchpoints типа "click"). Не используется в assistedAttribution / revenueAttributionMap / topAttributionPaths — там только visit_source_events + conversion_events. |

### Поля, используемые для связи

- **visitor_id** — основной ключ связи: visit_source_events.visitor_id = conversion_events.visitor_id; выборка визитов «до конверсии» по одному visitor_id.
- **click_id (bqcid)** — связь клика редиректа с визитом (visit_source_events.click_id) и с конверсией (conversion_events.click_id); в debugger — связь redirect_click_events.bq_click_id с visit_source_events.click_id и conversion_events.click_id.
- **user_external_id** — в conversion_events; в attributionDebugger/attributionJourney используется для группировки цепочек по одному пользователю (union-find по user_external_id и visitor_id).
- **visit_id** — в visit_source_events; в коде атрибуции используется в типах и выборках (AssistedAttribution, Debugger), но порядок касаний определяется по created_at, не по visit_id.
- **session_id** — есть в visit_source_events и conversion_events; в текущей логике first/last/assist **не используется** — порядок определяется только по visitor_id + created_at.

**Итог:** Связь visit ↔ conversion — по **visitor_id** и условию **created_at < conversion.created_at**. Дополнительно для цепочек и journey используются **click_id**, **user_external_id**.

---

## SECTION 2 — VISIT HISTORY

### Как хранится история касаний

История касаний = набор строк **visit_source_events** по одному visitor_id, упорядоченных по **created_at ASC**. Отдельной таблицы «touch_history» или «visit_history» нет.

### Можно ли восстановить цепочку «Meta Ads → Google Ads → Direct → Purchase»

**Да.** Для каждой конверсии в `assistedAttribution.ts` выбираются все визиты с тем же `visitor_id` и `created_at < conversion.created_at`, сортируются по `created_at` по возрастанию. По полям **traffic_source** (и при необходимости traffic_platform, utm_source и т.д.) строится последовательность каналов; последний шаг — конверсия (registration или purchase). В `topAttributionPaths.ts` та же логика: визиты по visitor_id, фильтр по времени до конверсии, маппинг traffic_source → метки (Meta Ads, Google Ads, Прямой переход и т.д.), склейка в путь вида «Meta Ads → Прямой переход → Покупка».

### Структура visit_source_events (поля, используемые в атрибуции)

| Поле | Тип | Использование |
|------|-----|----------------|
| visitor_id | text | Связь с конверсией и порядок визитов по пользователю |
| site_id | text | Фильтр по проекту (site_id = project_id) |
| created_at | timestamptz | Порядок касаний (ORDER BY created_at ASC для пути до конверсии) |
| traffic_source | text | Канал (meta, google, direct, …) — основной для first/last/assist |
| traffic_platform | text | Платформа (facebook_ads, google_ads, …) |
| source_classification | text | paid, organic_search, direct, … (используется в topAttributionPaths как fallback для источника) |
| touch_type | text | first / last на уровне одного визита (пиксель ставит при записи); в assisted path роли first_touch/last_touch/assist считаются заново по порядку визитов |
| click_id | text | Связь с redirect_click_events (bqcid) |
| visit_id | text | Идентификатор визита |
| referrer, utm_source, utm_medium, utm_campaign, utm_content, utm_term, gclid, fbclid, yclid, ttclid, session_id, fbp, fbc, landing_url | text | Есть в таблице; в ядре атрибуции (first/last/assist) используются в основном traffic_source / traffic_platform |

---

## SECTION 3 — FIRST TOUCH LOGIC

### Реализована ли логика first touch

**Да.** Определяется в коде, а не в SQL.

- **assistedAttribution.ts:** для каждой конверсии загружаются визиты по visitor_id с `created_at < conversion.created_at` с **ORDER BY created_at ASC**. Первый элемент массива (самый ранний визит) получает роль **first_touch**, последний — **last_touch**, остальные — **assist**. Функция `buildAttributionPathFromVisits(visits, conversionCreatedAt)` — чистая: сортировка по `created_at` по возрастанию и присвоение ролей по индексу (i === 0 → first_touch, i === length - 1 → last_touch, иначе assist).
- **attributionJourney.ts (Journey / Debugger):** first/last считаются по **кликам** в touchpoints: `first_touch_source` = source первого клика, `last_touch_source` = source последнего клика (массив уже отсортирован по timestamp).
- **attributionModels.ts:** first touch для распределения выручки — 100% revenue первому **click** в упорядоченном по времени списке touchpoints (не визитам).

### Используется ли ORDER BY created_at ASC для visitor_id

**Да.** В `app/lib/assistedAttribution.ts` запрос к visit_source_events:

```ts
.order("created_at", { ascending: true })
```

Выборка: `site_id = project_id`, `visitor_id = visitorId`, `created_at < conv.created_at`. Таким образом, первый по времени визит по visitor_id до конверсии и есть first touch.

---

## SECTION 4 — LAST TOUCH LOGIC

### Как определяется last touch

- **Assisted Attribution (assistedAttribution.ts):** тот же набор визитов, отсортированный по **created_at ASC**. Last touch = последний элемент массива (последний визит до конверсии). Отдельный ORDER BY created_at DESC не используется — достаточно ASC и взять последний элемент.
- **Attribution Journey / Debugger:** last touch = последний **click** в touchpoints по времени (touchpoints отсортированы по timestamp).
- **attributionModels.ts:** last touch = 100% revenue последнему **click** в упорядоченном списке.

**session_id** в логике first/last touch **не используется** — порядок везде определяется только по времени (created_at / timestamp).

---

## SECTION 5 — ASSISTED TOUCH

### Фиксируются ли промежуточные касания

**Да.** В `buildAttributionPathFromVisits` все визиты между первым и последним получают роль **assist**. В агрегатах (assistedAttribution channels, revenueAttributionMap, attributionHeatmap) считаются:

- **direct (last_touch)** — конверсии/выручка, приписанные каналу последнего касания;
- **assisted** — каналы, которые встречаются в пути как assist (промежуточные).

### Пример «Meta → Direct → Purchase»

- Meta = assist (промежуточное касание),
- Direct = last_touch (закрытие),
- Purchase = конверсия.

Такая разбивка поддерживается: путь строится по визитам до конверсии, роли first_touch / assist / last_touch назначаются по порядку визитов; в Revenue Attribution Map и блоках дашборда считается revenue_closed (last_touch) и revenue_assisted / assisted_conversions по каналам.

---

## SECTION 6 — ATTRIBUTION MODEL

### Какая модель используется «по умолчанию» в продукте

В дашборде и отчётах фактически используются:

1. **Multi-touch (first / assist / last)** — основной сценарий: путь строится из visit_source_events, роли first_touch, assist, last_touch назначаются в коде; агрегаты по каналам (direct_conversions, assisted_conversions, revenue_closed, revenue_assisted). Это видно в Помогающая атрибуция, Карта выручки по атрибуции, Топ путей.
2. **First touch и Last touch по выручке** — в Attribution Debugger и Budget Optimization: по journey считаются модели из `attributionModels.ts` (first_touch, last_touch, linear, position_based, data_driven) и выводятся revenue_first_touch, revenue_last_touch, ROAS first/last и т.д.

### Модели в коде (attributionModels.ts)

| Модель | Реализация |
|--------|------------|
| **First click** | 100% revenue первому click в пути (по времени). |
| **Last click** | 100% revenue последнему click. |
| **Linear** | Revenue делится поровну между всеми clicks. |
| **Position-based** | 40% первому, 40% последнему, 20% поровну между средними. |
| **Data-driven (упрощённая)** | Веса: first 0.3, last 0.5, middle 0.2/(n-2); бонус за visit/registration после клика. |

**Time decay** в коде **нет**. Position-based и data-driven используются в Debugger и Budget Optimization Insights, но не как отдельный «глобальный» выбор модели в настройках проекта.

---

## SECTION 7 — ENGINE LOCATION

### Где считается атрибуция

| Место | Файлы | Назначение |
|-------|--------|------------|
| **Backend (lib)** | `app/lib/assistedAttribution.ts` | Ядро: путь по visitor_id, first/assist/last, каналы. |
| | `app/lib/attributionModels.ts` | First/Last/Linear/Position-based/Data-driven по touchpoints и revenue. |
| | `app/lib/revenueAttributionMap.ts` | Выручка по каналам (closed/assisted) на базе assistedAttribution. |
| | `app/lib/topAttributionPaths.ts` | Топ путей (visit_source_events + conversion_events), агрегация по path_label. |
| | `app/lib/attributionHeatmap.ts` | First/assist/last по каналам на базе assistedAttribution. |
| | `app/lib/attributionJourney.ts` | Группировка цепочек в journey, first/last по кликам, вызов attributionModels. |
| | `app/lib/attributionDebugger.ts` | Построение цепочек Click→Visit→Reg→Purchase, выборки из redirect_click_events, visit_source_events, conversion_events. |
| | `app/lib/attributionFlow.ts` | Агрегация потоков на базе buildAssistedAttribution. |
| | `app/lib/budgetOptimizationInsights.ts` | Метрики по каналам (revenue first/last, ROAS) из journey и attributionModels. |
| **API** | `app/api/assisted-attribution/route.ts` | Вызов buildAssistedAttribution. |
| | `app/api/revenue-attribution-map/route.ts` | Вызов buildRevenueAttributionMap. |
| | `app/api/top-attribution-paths/route.ts` | Вызов buildTopAttributionPaths. |
| | `app/api/attribution-journeys/route.ts` | Цепочки + buildJourneysFromChains. |
| | `app/api/budget-optimization-insights/route.ts` | Insights с использованием journey и attributionModels. |
| | `app/api/executive-summary/route.ts`, `app/api/weekly-board-report/route.ts` | Используют buildJourneysFromChains. |
| **Frontend (dashboard)** | Компоненты дашборда, запросы к указанным API | Отображение блоков Помогающая атрибуция, Карта выручки, Топ путей, Attribution Debugger и т.д. Атрибуция не пересчитывается на фронте — только отображение. |

Расчёт атрибуции выполняется **в backend (Node.js)**: SQL только выборка данных (Supabase client); сортировка, роли first/assist/last и агрегаты — в TypeScript.

---

## SECTION 8 — PERFORMANCE

### Используются ли индексы

**Да.** Релевантные индексы:

- **visit_source_events:**  
  - `idx_visit_source_events_visitor_id`  
  - `idx_visit_source_events_site_id`  
  - `idx_visit_source_events_created_at`  
  - `idx_visit_source_events_visitor_site` (visitor_id, site_id)  
  - `idx_visit_source_events_visitor_id_created_at` (visitor_id, created_at) — для assisted attribution  
  - `idx_visit_source_events_visit_id`, `idx_visit_source_events_click_id`  
  - `idx_visit_source_events_traffic_source`  
  - `idx_visit_source_events_session_id`
- **conversion_events:**  
  - `idx_conversion_events_visitor_id`  
  - `idx_conversion_events_visitor_id_created_at` — для выборки конверсий по visitor и времени  
  - `idx_conversion_events_project_id`  
  - `idx_conversion_events_event_time`  
  - `idx_conversion_events_traffic_source`  
  - `idx_conversion_events_session_id`  
  - `idx_conversion_events_user_external_id`
- **redirect_click_events:**  
  - `idx_redirect_click_events_bq_click_id`  
  - `idx_redirect_click_events_project_id`  
  - `idx_redirect_click_events_created_at`  
  - `idx_redirect_click_events_traffic_source`

Отдельного индекса по **conversion_events(click_id)** в миграциях **нет** — при частых запросах по click_id может понадобиться.

---

## SECTION 9 — DASHBOARD USAGE

| Блок дашборда | Данные / движок |
|---------------|------------------|
| **Помогающая атрибуция** | `buildAssistedAttribution`: conversion_events + visit_source_events по visitor_id, путь first/assist/last, агрегат каналов (direct_conversions, assisted_conversions). |
| **Карта выручки по атрибуции** | `buildRevenueAttributionMap`: на базе buildAssistedAttribution, только purchase; по каналам — revenue_closed (last_touch), revenue_assisted, purchases_closed, purchases_assisted. |
| **Топ путей пользователей** | `buildTopAttributionPaths`: conversion_events + visit_source_events; по visitor_id визиты до конверсии, путь как строка (traffic_source → … → Регистрация/Покупка), агрегация по path_label. |
| **Attribution Debugger** | Цепочки из redirect_click_events, visit_source_events, conversion_events (по click_id, visitor_id); journey через attributionJourney; first/last по кликам; attributionModels для сравнения моделей по revenue. |
| **Budget Optimization Insights** | Journey (buildJourneysFromChains) + attributionModels (first_touch, last_touch, linear, position_based, data_driven); revenue и ROAS по каналам. |

---

## SECTION 10 — MISSING FEATURES

- **Time decay** — не реализован (нет затухания по времени до конверсии).
- **Linear / position-based / data-driven как выбор в настройках проекта** — модели есть в attributionModels и показываются в Debugger/Budget Insights, но нет единого переключателя «модель атрибуции по умолчанию» для отчётов.
- **Сохранение attribution snapshot** — атрибуция считается на лету при запросе; предрасчитанных снимков по датам/проектам в БД нет.
- **Индекс по conversion_events(click_id)** — может ускорить сценарии, завязанные на click_id.
- **Использование session_id в first/last** — сейчас порядок только по created_at; при желании «сессионной» атрибуции можно учитывать session_id (например, last touch в рамках сессии конверсии).

---

## SECTION 11 — FINAL REPORT

### 1. Current attribution model

- **Основная модель в продукте:** multi-touch с ролями first_touch / assist / last_touch по истории визитов (visit_source_events) до конверсии; связь по visitor_id и времени.
- **Дополнительно:** в Attribution Debugger и Budget Optimization считаются first_touch, last_touch, linear, position_based, data_driven по выручке на уровне journey (touchpoints = click, visit, registration, purchase).

### 2. Data used for attribution

- **visit_source_events:** visitor_id, site_id, created_at, traffic_source, traffic_platform, click_id, visit_id (и при необходимости source_classification, utm_*).
- **conversion_events:** project_id, visitor_id, event_name, created_at, value, currency, click_id, user_external_id, traffic_source.
- **redirect_click_events:** для цепочек и journey (bq_click_id, traffic_source, traffic_platform, created_at, utm_*).

### 3. Where attribution is calculated

- В **backend**: `app/lib/assistedAttribution.ts`, `app/lib/attributionModels.ts`, `app/lib/revenueAttributionMap.ts`, `app/lib/topAttributionPaths.ts`, `app/lib/attributionHeatmap.ts`, `app/lib/attributionJourney.ts`, `app/lib/attributionDebugger.ts`, `app/lib/attributionFlow.ts`, `app/lib/budgetOptimizationInsights.ts`.
- API-маршруты в `app/api/` вызывают эти модули; фронт только запрашивает API и отображает результат.

### 4. Supported attribution types

- **First touch** (по первому визиту/клику).
- **Last touch** (по последнему визиту/клику).
- **Assisted (multi-touch)** — учёт всех касаний с ролями first / assist / last.
- **Linear** — равное распределение по всем кликам (в attributionModels).
- **Position-based** — 40/40/20 (в attributionModels).
- **Data-driven (упрощённая)** — веса first/last/middle + бонусы за visit/reg (в attributionModels).

### 5. Missing attribution features

- Time decay.
- Выбор «модели по умолчанию» для отчётов в UI.
- Сохранение снимков атрибуции в БД.
- Индекс conversion_events(click_id) при необходимости.
- Учёт session_id в определении first/last (опционально).

---

*Конец отчёта. Код не изменялся.*
