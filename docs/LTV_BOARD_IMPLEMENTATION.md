# LTV Board — отчёт о реализации

**Дата:** 2025  
**Раздел:** `/app/ltv` и `/api/ltv` (без изменения layout и других разделов).

---

## 1. Какие метрики теперь считаются

### A. Purchase / User

| Метрика | Описание |
|--------|----------|
| `total_purchase_count` | Число всех purchase events в периоде `[start, end]`. |
| `first_purchase_count` | Число покупок в периоде, у которых `event_time === global_first_purchase_time` пользователя. |
| `repeat_purchase_count` | Число покупок в периоде, у которых `event_time > global_first_purchase_time`. |
| `unique_purchasers` | Число уникальных пользователей с non-null `user_key` (user_external_id \|\| visitor_id). |

### B. Revenue

| Метрика | Описание |
|--------|----------|
| `total_revenue` | Сумма `value` по всем покупкам в периоде. |
| `first_revenue` | Сумма `value` по first purchases в периоде. |
| `repeat_revenue` | Сумма `value` по repeat purchases в периоде. |
| `repeat_revenue_share` | `repeat_revenue / total_revenue`; при `total_revenue = 0` → `null`. |

### C. Retention (по campaign_intent)

| Метрика | Описание |
|--------|----------|
| `retention_purchases_count` | Число покупок в периоде с `campaign_intent = 'retention'`. |
| `retention_revenue` | Сумма `value` по этим покупкам. |
| `retention_revenue_share` | `retention_revenue / total_revenue`; при `total_revenue = 0` → `null`. |

### D. Economics

| Метрика | Описание |
|--------|----------|
| `spend` | Из getCanonicalSummary (daily_ad_metrics) за период. |
| `budget_for_repeat_sales` | project_monthly_plans.repeat_sales_budget для выбранного cohort_month. |
| `cpr` | CPR (plan): budget_for_repeat_sales / repeat_purchase_count; при denominator = 0 → `null`. |
| `retention_spend` | Фактический расход на retention: SUM(spend) по кампаниям, ведущим на ссылки с campaign_intent=retention (redirect_click_events → utm_campaign → campaigns → daily_ad_metrics_campaign). При ошибке или отсутствии данных → `null`. Ограничен сверху total spend. |
| `cpr_actual` | CPR (actual): retention_spend / retention_purchases_count; при retention_purchases_count = 0 → `null`. |
| `retention_roas` | retention_revenue / retention_spend; при retention_spend = 0 или null → `null`. |

### E. Value

| Метрика | Описание |
|--------|----------|
| `arpuMi` | total_revenue / unique_purchasers; при unique_purchasers = 0 → 0. |
| `ltvCum` | Накопленный LTV по глобальной first-purchase когорте (D1…D90). |
| `ltvXUsers` | ltvCum × cohort_size (когорта или unique_purchasers). |

### F. Health / Ratios

| Метрика | Описание |
|--------|----------|
| `repeat_purchase_rate` | repeat_purchase_count / total_purchase_count (доля повторных покупок по сделкам). |
| `repeat_purchasers_count` | Число пользователей с >1 покупкой за всё время и хотя бы одной в периоде. |
| `repeat_user_rate` | repeat_purchasers_count / unique_purchasers; при 0 → null. |
| `retention_user_rate` | Доля пользователей с хотя бы одной покупкой с campaign_intent=retention; при 0 unique_purchasers → null. |
| `first_revenue_share` | first_revenue / total_revenue; при total_revenue = 0 → null. |
| `retentionPct` | users(M0 active) / users(M0) × 100 по когорте. |
| `payingShare` | Не считаем: нет надёжного источника регистраций → `null`, в UI "—". |
| `revenueMoM` / `retentionMoM` | Не считаем (нет предыдущего периода в запросе) → `null`, в UI "—". |

---

## 2. Формулы (закреплённые)

- **First purchase:** событие, у которого `event_time` совпадает с глобальной первой покупкой пользователя (MIN(event_time) по всем покупкам пользователя за всё время).
- **Repeat purchase:** событие в периоде с `event_time > global_first_purchase_time`.
- **User key:** `user_external_id || visitor_id`; без fallback на event id (события без ключа не входят в unique_purchasers и byUser).
- **total_revenue:** сумма value по всем покупкам в периоде.
- **first_revenue / repeat_revenue:** суммы value по first/repeat в периоде; first_revenue + repeat_revenue может быть &lt; total_revenue из‑за покупок без user_key.
- **Shares:** repeat_revenue_share и retention_revenue_share при total_revenue = 0 → null.
- **CPR (plan):** budget_for_repeat_sales / repeat_purchase_count; при 0 повторных → null.
- **Retention spend:** кампании с campaign_intent=retention в redirect_click_events (utm_campaign) сопоставляются с campaigns (meta_campaign_id или external_campaign_id); SUM(spend) по daily_ad_metrics_campaign за период; не выше total spend.
- **CPR (actual):** retention_spend / retention_purchases_count; при 0 retention purchases → null.
- **Cohort heatmap "Оборот":** при наличии `cohortRevenueRows` из API используется реальная выручка по когортам по месяцам M0…M6; иначе — fallback на условный ARPU по месяцам (с сохранением подписи).

---

## 3. Что было добавлено / исправлено

- В API: `first_revenue`, `total_purchase_count`, `repeat_revenue_share`, `retention_revenue_share`, `repeat_purchase_rate`; явные `payingShare`, `revenueMoM`, `retentionMoM` = null.
- В API: `cohortRevenueRows` — реальная выручка по когорте по месяцам для режима "Оборот (₸)".
- На странице: в существующих карточках выведены First/Repeat purchases, repeat purchase rate; total/first/repeat revenue и repeat/retention revenue share; unique purchasers; spend; безопасное отображение "—" для null/undefined (paying share, MoM, CPR при 0).
- В UI: режим "Оборот" тепловой карты переведён на реальные данные при наличии `cohortRevenueRows`.

---

## 4. Ограничения данных

- **paying_share:** нет источника регистраций за период → не показываем фиктивное значение.
- **revenue_mom / retention_mom:** предыдущий период в API не запрашивается → честный null и "—" в UI.
- **Channel filter:** в API не применяется; фильтрация по каналу была бы возможна при наличии надёжной связи visit_source_events → conversion_events; оставлен "all channels" без подделки.
- Покупки без user_key учитываются в total_revenue и total_purchase_count, но не в first/repeat и не в unique_purchasers.

---

## 5. Source of truth для LTV-борда

- **Покупки и выручка:** таблица `conversion_events` (event_name = 'purchase'), период по `event_time`.
- **First/Repeat:** глобальная первая покупка по пользователю (paginated scan по всем purchase), классификация в периоде по этой дате.
- **Retention (сделки/выручка):** поле `campaign_intent = 'retention'` в conversion_events.
- **Бюджет на повторные продажи:** `project_monthly_plans.repeat_sales_budget`.
- **Retention spend (факт):** redirect_click_events (campaign_intent=retention) → utm_campaign → campaigns (meta_campaign_id / external_campaign_id) → daily_ad_metrics_campaign.spend за период.
- **Spend:** getCanonicalSummary (daily_ad_metrics).
- **Когорты и LTV-кривая:** когорты по месяцу первой покупки (user_first_date), активность по месяцам M0…M6; LTV D1…D90 от первой покупки.
