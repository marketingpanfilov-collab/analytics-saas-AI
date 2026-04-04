# Phase 0 — API route inventory (billing / access)

Сводка по критичным маршрутам после прохода [BILLING_SYSTEM_EXECUTION_PLAN.md](../BILLING_SYSTEM_EXECUTION_PLAN.md) Phase 0. Полный перечень `app/api/**/route.ts` не дублируется; ниже — write / heavy sync / OAuth data и явные исправления.

## Критичные write / sync (закрыты в Phase 0)

| Route | Auth | Project | Billing order (P0-LOG-01) | Примечание |
| ----- | ---- | ------- | --------------------------- | ---------- |
| POST `oauth/meta/connections/upsert` | session | да | heavy → project | было: admin write без auth |
| GET `oauth/meta/connections/list` | session | да | analytics read → project | было: утечка списка кабинетов |
| POST `oauth/meta/connections/save` | session | да | heavy → project | выровнено с upsert |
| POST `oauth/google/connections/save` | session | да | heavy → project | |
| POST `oauth/tiktok/connections/save` | session | да | heavy → project | |
| GET `oauth/meta/insights/sync` | session или internal secret | да | heavy → project (user); internal без pre-user | |
| GET `oauth/google/insights/sync` | то же | да | то же | |
| GET `oauth/tiktok/insights/sync` | то же | да | то же | |
| GET `oauth/meta/campaign-marketing-intent/sync` | то же | да | то же | |
| GET `oauth/meta/campaigns` | то же | да | то же | было: утечка Graph по project_id |
| GET `oauth/meta/campaigns/sync` | то же | да | то же | было: только admin + project_id |
| POST `dashboard/sync` | то же | да | heavy → project (user) | |
| POST `dashboard/refresh` | session | да | heavy → project | |
| POST `sync/run` | session (или internal при использовании secret на downstream) | косвенно через delegate | heavy pre-check перед делегированием | |

## Внутренние / публичные исключения (не менялись в этом проходе)

- Webhooks, health, публичный tracking pixel/conversion (по контракту продукта).
- `internal-admin/*`, `internal-sync/*`, `cron/*` — серверные роли; требуют отдельных секретов/ролей (вне scope Phase 0 billing shell).

## Рекомендация по расширению аудита

Оставшиеся GET dashboard (`bundle`, `kpi`, `metrics`, …) уже проходили через `requireProjectAccessOrInternal` + `billingAnalyticsReadGateFromAccess` в текущей ветке; при добавлении новых route handlers — копировать тот же паттерн и обновлять эту таблицу.
