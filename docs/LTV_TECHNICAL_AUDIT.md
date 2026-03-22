# Технический аудит раздела /app/ltv

**Дата:** 2025-03-06  
**Область:** только /app/ltv (frontend, API /api/ltv, используемые таблицы БД).  
**Цель:** понять логику LTV, корректность опоры на БД и готовность к работе с реальными данными.

---

## РАЗДЕЛ 1 — КАК РАБОТАЕТ /app/ltv

### 1.1 Блоки страницы и источники данных

| Блок | Что показывает | Откуда данные | Кто считает |
|------|----------------|---------------|-------------|
| **Фильтры** | Channel, Cohort | Channel — локальный state (список каналов захардкожен). Cohort — из `cohortMonths` (API `cohortRows` или demo). Period не отображается; `dateRange` в state и уходит в API. | Frontend (state). Cohort list — API или demo. |
| **Карточки: Users, Retention, Paying share** | Users, First/Repeat/Rate, Retention %, Paying share, LTV накоп. | `effectiveKpi` (API `kpi` или `DEMO_KPI_BY_COHORT[cohortMonth]`). | Backend — все метрики. Frontend — только форматирование и доля First/Repeat. |
| **Revenue composition** | Доли First / Repeat / Retention в выручке, бар по сегментам. | `firstRevShare`, `repeatRevShare`, `retentionRevShare` из `effectiveKpi` (first_revenue, repeat_revenue, retention_revenue, revenueMi). | Backend — суммы. Frontend — доли и бар. |
| **LTV × users, Revenue, ARPU, Unique purchasers** | Одна карточка с метриками. | `effectiveKpi`: ltvXUsers, revenueMi, arpuMi, unique_purchasers. | Backend. |
| **CPR (plan / actual)** | CPR plan, CPR actual. | `effectiveKpi`: cpr, cpr_actual. | Backend. |
| **Unit Economics** | ACQ CAC, RET Cost, True CAC, LTV D90, Profit, LTV/CAC. | `effectiveKpi` + производные на frontend: `cacAcquisition`, `retentionCost`, `trueCac`, `ltv`, `unitProfit`, `ltvCacRatio`. | Backend — сырые данные. Frontend — формулы CAC, True CAC, Profit, LTV/CAC. |
| **Retention Economics** | Budget, Actual spend, Difference, CPR, Retention ROAS, прогресс-бар. | `effectiveKpi`: budget_for_repeat_sales, retention_spend, cpr, cpr_actual, retention_roas. Frontend — difference, progressValue. | Backend + frontend (разница, прогресс). |
| **LTV Dynamics** | График LTV и ARPU по D1…D90. | `effectiveLineData` (API `lineData` или `DEMO_LINE_BY_COHORT`). | Backend — lineData. |
| **Payback block** | True CAC, LTV D90, Break-even point. | `effectiveKpi` + `sortedLineData`; break-even — frontend (первый день, где LTV ≥ True CAC). | Backend + frontend. |
| **Cohort Analysis** | Heatmap: Выручка / Пользователи / Retention %. | `cohortRows` (производный от `effectiveApiCohortRows`, `effectiveApiCohortRevenueRows`, `effectiveCohortSizes` в зависимости от `metric`). | Backend — cohortRows, cohortRevenueRows, cohortSizes. Frontend — переключение mode и преобразование в users/money. |

### 1.2 Откуда данные: real vs demo / fallback

- **Единый флаг demo:** `isDemoLtv` на frontend:  
  `data` есть и (`!data.kpi` или `unique_purchasers === 0` или `total_purchase_count === 0` или `!data.cohortRows?.length`).  
  В demo все блоки используют `effectiveKpi`, `effectiveLineData`, `effectiveApiCohortRows`, `effectiveApiCohortRevenueRows`, `effectiveCohortSizes` из констант DEMO_*.
- **Real:** те же переменные берутся из `data` (ответ API). Смешения real/demo внутри одного экрана нет: один раз определяется `isDemoLtv`, дальше везде effective-данные.
- **Fallback:** при `metric === "money"` и отсутствии `cohortRevenueRows` (и не demo) heatmap считает «деньги» через синтетический ARPU по месяцам (`arpuByMonthIndex`), т.е. подставляются не реальные выручки когорт.

### 1.3 Что считается на backend, что на frontend

- **Backend (API):** first/repeat/retention по покупкам, когорты (retention %, размеры, cohort revenue), LTV-кривая, spend (canonical), retention_spend, CPR, retention_roas, все доли (first_revenue_share и т.д.).
- **Frontend:** форматирование денег (formatMoney с учётом валюты проекта и курса), доли для revenue composition (firstRevShare и т.д.), CAC = acquisitionSpend / firstPurchaseCount, retentionCost = retentionSpend / repeatPurchasersCount, True CAC = CAC + retentionCost, unitProfit, ltvCacRatio, break-even по sortedLineData, преобразование cohort rows в «users»/«money» для heatmap.

---

## РАЗДЕЛ 2 — КАРТА МЕТРИК

| UI-блок | Метрика | API поле | Источник БД | Формула | Риск |
|--------|---------|----------|------------|---------|------|
| Users | Users (число) | kpi.usersMi | conversion_events (когорта по first purchase month) | При выбранной когорте: размер когорты (usersM0). Иначе unique_purchasers. | Низкий |
| Users | First | kpi.first_purchase_count | conversion_events | В периоде [start,end]: покупки, у которых event_time === global first_purchase_time пользователя. | Средний: first по точному совпадению времени. |
| Users | Repeat | kpi.repeat_purchase_count | conversion_events | В периоде: покупки, у которых event_time !== global first. | Низкий |
| Users | Rate | kpi.repeat_purchase_rate | — | repeat_purchase_count / total_purchase_count (по периоду). | Средний: Rate — доля повторных транзакций, а не «Repeat users / First users». |
| Retention | Retention % | kpi.retentionPct | conversion_events | m0Active / usersM0 * 100 (доля когорты M0, совершившая покупку в M0). | Высокий: подпись «users(Mi)/users(M0)», по факту для M0 это активность в том же месяце. |
| Paying share | Paying share | kpi.payingShare | — | API всегда null (нет регистраций). | Низкий (всегда «—» или demo). |
| Revenue composition | First / Repeat / Retention | first_revenue, repeat_revenue, retention_revenue | conversion_events (value, campaign_intent) | first_revenue + repeat_revenue = total; retention_revenue ⊆ repeat (по campaign_intent). | Критический: три сегмента First + Repeat + Retention дают сумму > 100%; Repeat и Retention пересекаются. |
| LTV × users | LTV × users | kpi.ltvXUsers | — | ltvCum * cohortSize. | Низкий |
| LTV × users | Revenue | kpi.revenueMi | conversion_events | totalRevenue в [start,end] (все покупки). | Средний: не фильтр по когорте; при выбранной когорте «Revenue» — за весь период. |
| LTV × users | ARPU | kpi.arpuMi | — | revenueMi / unique_purchasers. | Низкий |
| CPR | CPR (plan) | kpi.cpr | project_monthly_plans.repeat_sales_budget | budget_for_repeat_sales / repeat_purchase_count. | Низкий |
| CPR | CPR (actual) | kpi.cpr_actual | retention_spend, retention_purchases_count | retention_spend / retention_purchase_count. | Средний: знаменатель — покупки с campaign_intent=retention, числитель — spend по retention-кампаниям; несовпадение маппинга даёт искажение. |
| Unit Economics | ACQ CAC | — | Frontend | spend - retention_spend / first_purchase_count. | Средний: spend из canonical (все каналы), не по когорте. |
| Unit Economics | RET Cost | — | Frontend | retention_spend / repeat_purchasers_count. | Средний: repeat_purchasers_count = пользователи с >1 покупкой когда-либо; знаменатель не «retention purchasers». |
| Unit Economics | True CAC | — | Frontend | ACQ CAC + RET Cost. | Зависит от двух выше. |
| Unit Economics | LTV D90 | kpi.ltvCum | conversion_events (LTV по когорте до D90) | Сумма value по когорте до 90 дней от first purchase. | Низкий |
| Unit Economics | LTV/CAC | — | Frontend | ltv / trueCac. | Низкий |
| Retention Economics | Budget / Actual / Difference | budget_for_repeat_sales, retention_spend | project_monthly_plans, daily_ad_metrics_campaign | — | Низкий |
| Retention Economics | Retention ROAS | kpi.retention_roas | — | retention_revenue / retention_spend. | Низкий |
| LTV Dynamics | Точки D1…D90 | lineData | conversion_events | По когорте: накопленная выручка и ARPU до горизонта D. | Низкий |
| Payback | Break-even | — | Frontend | Первый день в lineData, где ltv >= trueCac. | Низкий |
| Cohort Analysis | Retention % | cohortRows | conversion_events | По каждой когорте: (active in month / M0 size) * 100. | Низкий |
| Cohort Analysis | Выручка | cohortRevenueRows | conversion_events | Реальная выручка по когорте по месяцам M0…M6. | Низкий |
| Cohort Analysis | Пользователи | — | Frontend | (percent/100) * cohortSizes. | Низкий |

---

## РАЗДЕЛ 3 — КРИТИЧЕСКИЕ ПРОБЛЕМЫ

### CRITICAL

1. **Revenue composition: три сегмента не образуют 100% и пересекаются по смыслу.**  
   First + Repeat = 100% выручки периода. Retention — подмножество Repeat (покупки с campaign_intent=retention). На UI показываются три доли: firstRevShare, repeatRevShare, retentionRevShare. Их сумма = 1 + (retentionRevenue/totalRev) в части повторной выручки, т.е. визуально бар «переполняется», либо интерпретация «Repeat» и «Retention» как непересекающихся неверна.  
   **Файл:** `page.tsx` (расчёт firstRevShare, repeatRevShare, retentionRevShare и flex для сегментов).

2. **Валюта: API не учитывает currency, frontend предполагает KZT.**  
   В `conversion_events` есть поле `currency`; API его не читает и не агрегирует по валютам. Все суммы трактуются как одна валюта. Frontend в `formatMoney` считает значения «в KZT» и конвертирует в выбранную валюту (USD/KZT). Если в БД хранится USD, отображение будет неверным (двойная конвертация или неверный курс).  
   **Файлы:** `api/ltv/route.ts` (нет использования currency), `page.tsx` (formatMoney, комментарий «считаем в KZT»).

3. **Фильтр Channel не передаётся в API.**  
   В запрос уходят только `project_id`, `start`, `end`, `cohort_month`. Выбор канала не влияет на данные — «мёртвый» фильтр.  
   **Файлы:** `page.tsx` (state channel, fetchLtv без channel), `api/ltv/route.ts` (нет параметра channel).

### MEDIUM

4. **Retention (карточка): подпись «users(Mi)/users(M0)», фактически — активность в M0.**  
   `retentionPct` в API = m0Active / usersM0 (доля пользователей когорты, совершивших покупку в месяце M0). То есть это не «retention после первой покупки», а активность в том же месяце. Надпись под баром «users(Mi) / users(M0)» вводит в заблуждение.  
   **Файл:** `api/ltv/route.ts` (расчёт retentionPct, m0Active), `page.tsx` (подпись).

5. **Repeat rate: формула в UI не совпадает с API.**  
   Tooltip: «Repeat users / First purchase users». API: `repeat_purchase_rate = repeat_purchase_count / total_purchase_count` (доля повторных транзакций среди всех транзакций в периоде). Это разные метрики.  
   **Файлы:** `api/ltv/route.ts`, `page.tsx` (HelpTooltip и отображение Rate).

6. **Cohort «Выручка» без реальных cohortRevenueRows: синтетические значения.**  
   При `metric === "money"` и пустом `effectiveApiCohortRevenueRows` (real, не demo) heatmap считает «выручку» как (percent/100)*size*arpuByMonthIndex[i] — захардкоженный ARPU по месяцам. Это не реальная выручка когорт.  
   **Файл:** `page.tsx` (useMemo для cohortRows, ветка money без cohortRevenueRows).

7. **Insight «Retention revenue dominates acquisition revenue»:** сравниваются repeat_revenue и first_revenue; формулировка про «retention» может путать с метрикой retention_revenue (campaign_intent).  
   **Файл:** `page.tsx` (insights).

8. **First purchase: сравнение по точному совпадению event_time.**  
   First = (event_time === globalFirst). При округлении времени или дубликатах возможны краевые случаи.  
   **Файл:** `api/ltv/route.ts`.

### LOW

9. **Paying share всегда null:** блок по сути неинформативен в real (нет данных о регистрациях).  
10. **Retention Economics progress:** «Plan vs actual retention spend» — подпись на английском при русском интерфейсе.  
11. **Лейбл «Retention» в Revenue composition:** по смыслу это «выручка с retention-кампаний», а не «возврат по когорте»; возможна путаница с карточкой Retention %.

---

## РАЗДЕЛ 4 — ПРОБЛЕМЫ БД ДЛЯ /app/ltv

### Таблицы и поля, реально используемые API

- **conversion_events:** project_id, event_name, event_time, created_at, user_external_id, visitor_id, value, campaign_intent.  
  Обязательны для расчётов: project_id, event_name, event_time, user_external_id или visitor_id (хотя бы один для учёта пользователя), value (для выручки).  
  Null: user_external_id и visitor_id — событие не привязано к пользователю и не участвует в byUser/когортах (риск недосчёта). value = null трактуется как 0. campaign_intent используется для retention_revenue и retention_purchases_count; null — не retention.

- **redirect_click_events:** project_id, utm_campaign, campaign_intent.  
  Используется для списка utm_campaign с campaign_intent = 'retention' (ilike). Связь с кампаниями по utm_campaign.

- **campaigns:** project_id, id, meta_campaign_id, external_campaign_id.  
  Маппинг: utm_campaign из кликов в campaign.id через meta_campaign_id или external_campaign_id. Если utm_campaign не совпадает с id рекламной кампании (разный формат, другой источник), retention spend не сматчится.

- **daily_ad_metrics_campaign (view):** campaign_id, date, spend, ad_account_id, platform.  
  LTV API берёт spend по campaign_id и датам [start, end]. Зависит от того, что campaign_id заполнен и соответствует campaigns.id.

- **project_monthly_plans:** project_id, year, month, repeat_sales_budget.  
  Для CPR (plan) по выбранной когорте.

- **getCanonicalSummary:** daily_ad_metrics (через join с ad_accounts и т.д.) — общий spend по проекту за период. Не фильтруется по channel; LTV не передаёт в getCanonicalSummary фильтр каналов.

### Связи и риски

- **retention_spend:** redirect_click_events (utm_campaign, campaign_intent) → campaigns (meta_campaign_id / external_campaign_id = utm_campaign) → daily_ad_metrics_campaign (campaign_id). Хрупкость: несовпадение формата utm_campaign и id кампании (Meta act_*, внешний id и т.д.) → 0 retention spend и заниженный/нулевой CPR actual, искажённый ROAS.
- **conversion_events.campaign_intent:** должен проставляться пайплайном (pixel / click_id → redirect). Если не заполнен, retention_revenue и retention_purchases_count = 0 при ненулевом retention spend — несопоставимые числитель и знаменатель в CPR actual и ROAS.
- **Двойной счёт:** не выявлен: покупки считаются по event_time в периоде, first/repeat — по глобальному first.
- **Недосчёт:** события без user_external_id и visitor_id не попадают в когорты и в unique_purchasers; выручка по ним в totalRevenue учитывается, но не в first/repeat по пользователям.

### Индексы

- Используются: project_id, event_time, event_name (для conversion_events), idx_conversion_events_campaign_intent.  
- Запросы: пагинация по event_time (order event_time, range), фильтры project_id, event_name. Для больших объёмов желательны составные индексы (project_id, event_name, event_time) и (project_id, event_time) для двух типов запросов (global first vs purchases in period).

### Currency в БД

- conversion_events.currency в API не используется; агрегации по валюте нет. Для мультивалютности нужна логика на backend (группировка по currency и отдача в одной валюте или по валютам).

---

## РАЗДЕЛ 5 — ЧТО НУЖНО ИСПРАВИТЬ ДО ПОДКЛЮЧЕНИЯ REAL DATA

### 1. Must fix before real launch

- Привести Revenue composition к непересекающимся сегментам: либо «First | Repeat (без retention) | Retention», с явной формулой и данными с API (например, repeat_revenue_excluding_retention или считать на backend), либо один бар «First / Repeat» и отдельно показывать долю retention.
- Определить и зафиксировать валюту данных в conversion_events (или хранить в одной валюте и указывать её). На backend либо не конвертировать и отдавать «как есть» с полем currency, либо конвертировать в валюту проекта; на frontend не предполагать KZT по умолчанию без знания реальной валюты.
- Убрать или реализовать фильтр Channel: либо убрать из UI, либо добавить в API фильтрацию по источнику/каналу (например, по traffic_source или по привязке к рекламным кампаниям) и передавать параметр в запрос.

### 2. Should fix soon

- Переименовать или пересчитать Retention (карточка): либо считать retention как долю когорты, вернувшейся в M1+ (и поправить подпись), либо оставить текущий показатель, но сменить подпись (например, «Active in cohort month»).
- Привести Repeat rate в соответствие с UI: либо изменить API на repeat_purchasers_count / first_purchase_count (по пользователям), либо изменить подпись и формулу в tooltip на «доля повторных транзакций в периоде».
- Режим «Выручка» в Cohort Analysis: при отсутствии cohortRevenueRows не подставлять синтетический ARPU; показывать явный fallback («Нет данных по выручке когорт») или отключать режим.
- Документировать маппинг retention spend (utm_campaign ↔ meta_campaign_id/external_campaign_id) и при необходимости добавить нормализацию/маппинг, чтобы retention-клики находили кампании.

### 3. Nice to have

- Paying share: либо убрать блок, либо подключать источник регистраций и считать метрику.
- Индексы для conversion_events под тяжёлые запросы LTV (project_id, event_name, event_time и т.д.).
- Единая терминология: развести «repeat» (вторая и далее покупки), «retention» (поведение по когорте) и «retention» (campaign_intent) в копиях и подсказках.

---

## 6. REPEAT VS RETENTION (ОТДЕЛЬНЫЙ БЛОК)

- **Repeat (транзакции):** в API repeat_purchase_count = покупки в периоде, у которых event_time !== глобальная первая покупка пользователя. repeat_revenue — сумма value по таким покупкам.  
  **Где на /app/ltv:** карточка Users (Repeat), Revenue composition (сегмент «Repeat revenue»), Unit Economics (RET Cost использует repeat_purchasers_count).

- **Retention (поведение по когорте):** в API retentionPct = m0Active / usersM0 (доля когорты M0, активная в M0). cohortRows — доли когорты, активные в M1, M2, … (retention по месяцам).  
  **Где на /app/ltv:** карточка «Retention», подпись «users(Mi)/users(M0)», heatmap в режиме «Retention %».

- **Retention (campaign_intent):** в API retention_revenue и retention_purchases_count — только покупки с campaign_intent = 'retention'. retention_spend — spend по кампаниям, связанным с retention-кликами (utm_campaign).  
  **Где на /app/ltv:** Revenue composition (сегмент «Retention revenue»), CPR (actual), Retention Economics, insight «Retention campaigns…».

**Смешение:** В одном блоке Revenue composition показываются три сегмента: First, Repeat (все повторные), Retention (только с меткой retention). Repeat и Retention не исключают друг друга — пользователь может воспринять их как два непересекающихся типа выручки. Нужно явно разделять в подписях: «Repeat (все повторные)» и «Retention (по retention-кампаниям)» или изменить состав сегментов.

---

## 7. DEMO MODE

- **Единый флаг:** один раз вычисляется `isDemoLtv` по ответу API (пустые/нулевые данные).  
- **Effective data:** везде используются effectiveKpi, effectiveLineData, effectiveApiCohortRows, effectiveApiCohortRevenueRows, effectiveCohortSizes — при demo из констант, при real из data. Смешения real/demo в одном экране нет.  
- **Смена cohort в demo:** effectiveKpi и effectiveLineData зависят от cohortMonth (DEMO_KPI_BY_COHORT, DEMO_LINE_BY_COHORT). Heatmap и список когорт — из DEMO_* констант.  
- **Смена currency в demo:** все суммы проходят через fmtMoney (formatMoney с projectCurrency и usdToKztRate); demo-значения в константах заданы в «условных единицах», frontend трактует их как KZT и конвертирует — при смене валюты отображение меняется.  
- **Tooltips и графики:** используют те же effective значения и fmtMoney.

---

## 8. CURRENCY / FORMAT

- **Определение валюты:** из `/api/projects/currency` (project_id); курс из POST `/api/system/update-rates`.  
- **Форматирование:** единое через formatMoney (KZT — как есть с «₸ », USD — valueKzt/rate через fmtProjectCurrency). Все суммы на странице и в LtvChart/CohortHeatmap (formatMoney prop) проходят через него.  
- **Demo при смене валюты:** меняется отображение (те же числа конвертируются).  
- **Real при смене валюты:** числа с API не зависят от валюты; frontend считает их KZT и конвертирует — при реальных данных в USD логика неверна.  
- **Cohort revenue mode:** значения из cohortRevenueRows форматируются через formatMoney; при смене валюты отображение меняется. Логика не ломается.

---

## 9. COHORT LOGIC

- **Выбор cohort month:** из списка cohortMonths (последние 5 когорт из API или demo). При смене cohort перезапрашивается API с новым cohort_month; в demo подставляются DEMO_KPI_BY_COHORT[cohortMonth], DEMO_LINE_BY_COHORT[cohortMonth].  
- **cohortRows (API):** для каждой из последних 5 когорт — массив из 7 значений (M0…M6): доля когорты (%), активная в этом месяце.  
- **cohortRevenueRows:** для тех же когорт — выручка по месяцам M0…M6 (сумма value по событиям когорты в каждом месяце).  
- **cohortSizes:** число пользователей в каждой когорте (M0).  
- **Heatmap режимы:** «Retention %» — percent как есть; «Пользователи» — (percent/100)*cohortSizes; «Выручка» — cohortRevenueRows если есть, иначе синтетика (percent*size*arpuByMonthIndex).  
- **Фейковые fallback:** режим «Выручка» при отсутствии cohortRevenueRows (real) — синтетические значения. Остальные режимы и demo — фактические или явные demo-данные.

---

## 10. RETENTION SPEND

- **Как считается:** берутся utm_campaign из redirect_click_events где campaign_intent ilike 'retention'. По списку utm_campaign ищутся campaigns где meta_campaign_id IN (...) OR external_campaign_id IN (...). По полученным campaign id выбирается spend из daily_ad_metrics_campaign за [start, end]. Сумма = retention_spend. Ограничение: retention_spend ≤ spend (canonical).  
- **Риски:** несовпадение utm_campaign с meta_campaign_id/external_campaign_id (разные форматы, кодировки) → 0. Отсутствие campaign_id в daily_ad_metrics → эти кампании не участвуют.  
- **cpr_actual:** retention_spend / retention_purchase_count. retention_purchase_count — число покупок с campaign_intent = 'retention'. Если конверсии не помечены campaign_intent (или приходят не через retention-ссылки), знаменатель занижен, CPR завышен.

---

## ИТОГОВЫЕ ОТВЕТЫ

**1. Готов ли /app/ltv к подключению реальных данных?**  
Нет без доработок. Критично: (1) исправить Revenue composition (непересекающиеся сегменты или честная подпись), (2) согласовать валюту (backend/frontend и при необходимости использование conversion_events.currency), (3) убрать или реализовать фильтр Channel.

**2. Какие 5 главных рисков сейчас?**  
(1) Revenue composition вводит в заблуждение (Repeat и Retention пересекаются, сумма долей > 100%). (2) Валюта: данные могут быть в USD при предположении KZT на frontend. (3) Channel не влияет на данные. (4) Retention (карточка) подписана как «users(Mi)/users(M0)», а считается активность в M0. (5) Retention spend и CPR actual зависят от хрупкого маппинга utm_campaign ↔ campaigns и от заполнения campaign_intent в конверсиях.

**3. Что обязательно исправить в БД / логике, чтобы LTV борд считался корректно?**  
(1) Логика: определить и реализовать непересекающиеся сегменты выручки (First / Repeat без retention / Retention) или явно обозначить пересечение. (2) Валюта: использовать conversion_events.currency на backend (агрегация/нормализация в одну валюту) и убрать предположение «всё в KZT» на frontend. (3) Либо убрать фильтр Channel, либо добавить его в API и БД-запросы. (4) Retention (карточка): либо пересчитать под «retention по месяцам», либо исправить подпись. (5) Режим «Выручка» в heatmap: не использовать синтетический ARPU; при отсутствии cohortRevenueRows показывать явный fallback или отключить режим.
