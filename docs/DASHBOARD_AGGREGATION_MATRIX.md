# Dashboard aggregation matrix

After backend hardening (project access, fallback removal, canonical-only where applicable).

| Endpoint | Source (branch) | Filters (sources / accountIds) | Aggregation consistent with |
|----------|-----------------|--------------------------------|------------------------------|
| GET /api/dashboard/summary | canonical or cache (canonical) | Yes (sources, accountIds) | Same rule: daily_ad_metrics_campaign, resolveAdAccountIds |
| GET /api/dashboard/timeseries | canonical or cache (canonical) | Yes | Same as summary (no RPC fallback) |
| GET /api/dashboard/metrics | canonical or cache (canonical) | Yes | Same; empty [] when no rows (no legacy fallback) |
| GET /api/dashboard/kpi | conversion_events + visit_source_events | Yes (sources) | N/A (conversions; separate from spend) |
| GET /api/dashboard/timeseries-conversions | conversion_events + visit_source_events | Yes | Same as kpi |
| GET /api/dashboard/accounts | ad_accounts + settings + daily_ad_metrics | N/A (list) | N/A |
| GET /api/dashboard/source-options | integrations + ad_accounts + visits + conversions | N/A (options) | N/A |

## Data path

- **Canonical:** `dashboardCanonical.ts` → `resolveAdAccountIds(projectId, sources, accountIds)` → `daily_ad_metrics_campaign` (campaign-level only) → aggregate by date / totals.
- **Cache:** Key includes project_id, start, end, sourcesKey, accountIdsKey. Only canonical responses are cached (no legacy/RPC).
- **Summary vs timeseries:** Both use `fetchCanonicalRowsViaJoin` / getCanonicalSummary / getCanonicalTimeseries with the same options; totals and chart are from the same dataset when both hit canonical or both use cache.

## Removed / disabled

- **Timeseries RPC fallback:** Removed. When canonical returns no rows, response is `points: []` so chart and summary stay aligned.
- **Metrics legacy fallback:** Removed. When canonical returns no rows, response is `[]`. No read from `dashboard_meta_metrics` (no project filter).
