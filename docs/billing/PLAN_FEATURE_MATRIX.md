# Матрица тарифов и ограничений (код)

Сводка того, что **сейчас зашито в приложении**. Числа и флаги нужно менять в исходниках; этот файл затем обновить.

**Канон лимитов и фич:** [`app/lib/planConfig.ts`](../../app/lib/planConfig.ts) (`PlanFeatureMatrix`, `getPlanFeatureMatrix`).

---

## Slug тарифа

Используется в query `plan` на `/login`, Paddle `customData`, `billing_entitlements.plan_override` и т.д.: `starter` | `growth` | `scale`.

Источник списка: [`app/lib/auth/loginPurchaseUrl.ts`](../../app/lib/auth/loginPurchaseUrl.ts) (`PRICING_PLAN_IDS`). Legacy query `plan=agency` нормализуется в `scale` на клиенте.

---

## Таблица по тарифам

Отображаемые имена и цены в UI: [`app/lib/billingPlanDisplay.ts`](../../app/lib/billingPlanDisplay.ts).

TTL «свежести» дашборда (порог устаревания для stale-check): [`app/lib/dashboardFreshness.ts`](../../app/lib/dashboardFreshness.ts) — `getEffectiveDashboardTtlMs`.

| План (slug) | Отображаемое имя | max_projects | max_seats | max_ad_accounts | ltv_full_history | attribution_heavy | marketing_summary | $ / мес | Скидка год (%) | $ / год (округление как в коде) | TTL дашборда |
|-------------|------------------|-------------|-----------|-----------------|------------------|-------------------|-------------------|---------|----------------|-----------------------------------|--------------|
| starter | Starter | 1 | 1 | 3 | нет | нет | да | 39 | 10 | 421 | 6 ч |
| growth | Growth | 3 | 10 | 10 | да | да | да | 99 | 15 | 1010 | 3 ч |
| scale | Scale | ∞ (null) | ∞ (null) | ∞ (null) | да | да | да | 249 | 20 | 2390 | 15 мин |

Значение **∞ (null)** означает: в матрице лимит не задан (`null`), отдельной цифры «безлимит» в коде нет.

Формула годовой цены: `round(monthly × 12 × (1 − discountPercent / 100))` — как в `billingYearlyTotalUsd`.

---

## План `unknown`

Если эффективный план не распознан, [`getPlanFeatureMatrix`](../../app/lib/planConfig.ts) возвращает матрицу `unknown`: все `max_*` = `null`, `ltv_full_history` / `attribution_heavy` / `marketing_summary` = `false`.

---

## Как лимиты применяются (enforcement)

| Сценарий | Где | Условие |
|----------|-----|---------|
| Создание проекта | [`app/lib/projectPlanLimit.ts`](../../app/lib/projectPlanLimit.ts), [`POST /api/projects`](../../app/api/projects/route.ts) | При заданном `max_projects`: блок, если **число активных (неархивных) проектов организации ≥ max_projects**. |
| Добавление участника орг. | [`countBillableSeatsForOrganization`](../../app/lib/orgSeatPlanLimit.ts), [`POST /api/org-members/add`](../../app/api/org-members/add/route.ts) | При заданном `max_seats`: блок, если **число billable seats ≥ max_seats** и добавляемый пользователь **ещё не** входит в union (см. ниже). |
| Добавление участника проекта (прямое) | Тот же канон seats, [`POST /api/project-members/add`](../../app/api/project-members/add/route.ts) | Как у org-add: **`userHasBillableSeatInOrganization`** → разрешить без нового места; иначе **`isAtOrgSeatPlanLimit`** по **`countBillableSeatsForOrganization`**. Insert через service role. |
| Включение рекламных аккаунтов (Meta / Google / TikTok) | [`app/lib/adAccountPlanLimit.ts`](../../app/lib/adAccountPlanLimit.ts), `POST` [`.../meta/connections/save`](../../app/api/oauth/meta/connections/save/route.ts), [`.../google/connections/save`](../../app/api/oauth/google/connections/save/route.ts), [`.../tiktok/connections/save`](../../app/api/oauth/tiktok/connections/save/route.ts) | При заданном `max_ad_accounts`: после сохранения выбора не должно получиться **больше** включённых аккаунтов в организации, чем лимит. Подсчёт — как у дашборда: [`collectEnabledAdAccountIdsForOrganization`](../../app/lib/dashboardCanonical.ts) / `resolveEnabledAdAccountIdsForProject`. |
| Over-limit fullscreen / shell | [`computeOverLimitViolations` в `billingCurrentPlan.ts`](../../app/lib/billingCurrentPlan.ts) | Для **seats**: `current` = **уникальные `user_id`**: `organization_members` ∪ `project_members` по проектам организации (`countBillableSeatsForOrganization`). Pending invites **не** входят. Нарушение, если **current > limit**. |
| Seats и ad_accounts в том же shell | тот же `computeOverLimitViolations` | Та же семантика **`>`**. |

Подсчёт проектов для shell и для лимита создания: неархивные строки в `projects` по `organization_id` (см. код в указанных файлах). Подсчёт рекламных аккаунтов для shell и для лимита сохранения выбора — объединение включённых аккаунтов по всем проектам организации (каноническая логика включённости, см. `dashboardCanonical`).

Лимит `max_seats` из [`planConfig.ts`](../../app/lib/planConfig.ts) перед использованием нормализуется функцией `normalizeMaxSeatsForEnforcement`: `null` остаётся без лимита; любое число меньше 1 приводится к **1** (чтобы не получить ложный over-limit при одном участнике и лимите 0).

Разбор мест по `user_id` (орг / проекты / union): см. [`getBillableSeatsBreakdownForOrganization`](../../app/lib/orgSeatPlanLimit.ts), ответ `GET /api/org-members/list?seat_audit=1`, SQL [`billable_seats_audit.sql`](./billable_seats_audit.sql). Bootstrap считает seats для `primary_org_id` из [`getPrimaryOwnerOrgId`](../../app/lib/billingCurrentPlan.ts) — при одном членстве совпадает с org на экране «Команда».

---

## Копирайт

Тексты в [`INLINE_PLAN_TAGLINE`](../../app/lib/billingPlanDisplay.ts), лендинг и [`pricing-comparison`](../../app/pricing-comparison/page.tsx) должны совпадать с лимитами из [`planConfig.ts`](../../app/lib/planConfig.ts).

---

## Вне этой матрицы

Маркетинговые таблицы и формулировки на лендинге и на странице сравнения не дублируются здесь (риск расхождения с сервером). См. например [`app/pricing-comparison/page.tsx`](../../app/pricing-comparison/page.tsx).
