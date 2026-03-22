# Backend hardening report — analytics-saas

**Date:** 2026-03-06  
**Based on:** BACKEND_AUDIT_REPORT.md

---

## 1. Summary

- **Security:** All dashboard and sync API routes now enforce project access via `requireProjectAccessOrInternal`. Internal server-only bypass (header `X-Internal-Sync-Secret`) is used only for POST /api/dashboard/sync and for Meta/Google insights sync when called from that sync or from backfill.
- **Fallbacks:** Dangerous fallbacks removed: metrics no longer read from `dashboard_meta_metrics`; timeseries no longer use RPC `dashboard_meta_timeseries` when canonical is empty (return empty points instead).
- **Sync:** Meta sync writes `ad_accounts_id` on campaign upsert; `project_id` removed from all `daily_ad_metrics` insert payloads (Meta + Google).
- **Aggregation:** Summary, timeseries, and metrics use the same canonical path and filters; matrix documented in DASHBOARD_AGGREGATION_MATRIX.md.
- **Legacy:** Strategy for campaigns with `ad_accounts_id IS NULL` documented in LEGACY_CAMPAIGNS_CLEANUP_STRATEGY.md; no NOT NULL until safe.

---

## 2. List of changed files

| File | Change |
|------|--------|
| `app/lib/auth/requireProjectAccessOrInternal.ts` | **New.** Unified project access check + optional internal bypass (header). |
| `app/api/dashboard/summary/route.ts` | Require project access; log access_source. |
| `app/api/dashboard/timeseries/route.ts` | Require project access; remove RPC fallback (return empty points); log access_source. |
| `app/api/dashboard/metrics/route.ts` | Require project_id + project access; remove legacy fallback (return []); log branch. |
| `app/api/dashboard/kpi/route.ts` | Require project access. |
| `app/api/dashboard/accounts/route.ts` | Require project access. |
| `app/api/dashboard/source-options/route.ts` | Require project access. |
| `app/api/dashboard/timeseries-conversions/route.ts` | Require project access. |
| `app/api/dashboard/refresh/route.ts` | Require project access; pass internal header when calling sync. |
| `app/api/dashboard/sync/route.ts` | Require project access with `allowInternalBypass: true`; pass internal header to Meta/Google sync fetches. |
| `app/api/oauth/meta/insights/sync/route.ts` | Require project access (with internal bypass); set `ad_accounts_id` on campaign upsert; remove `project_id` from daily_ad_metrics inserts. |
| `app/api/oauth/google/insights/sync/route.ts` | Require project access (with internal bypass); remove `project_id` from daily_ad_metrics inserts. |
| `app/lib/dashboardBackfill.ts` | Pass internal sync headers when calling POST /api/dashboard/sync. |
| `app/lib/dashboardCanonical.ts` | Log branch in CANONICAL_SUMMARY_AGG and CANONICAL_TIMESERIES_PATH. |
| `docs/LEGACY_CAMPAIGNS_CLEANUP_STRATEGY.md` | **New.** Strategy for ad_accounts_id IS NULL. |
| `docs/DASHBOARD_AGGREGATION_MATRIX.md` | **New.** Endpoint → source → filters → consistency. |
| `docs/BACKEND_HARDENING_REPORT.md` | **New.** This report. |

---

## 3. Routes: access enforced vs internal bypass

### Access enforced (user or internal header), no bypass for normal callers

- GET /api/dashboard/summary  
- GET /api/dashboard/timeseries  
- GET /api/dashboard/metrics  
- GET /api/dashboard/kpi  
- GET /api/dashboard/accounts  
- GET /api/dashboard/source-options  
- GET /api/dashboard/timeseries-conversions  
- POST /api/dashboard/refresh  

### Internal server-only bypass (allowInternalBypass: true)

- POST /api/dashboard/sync — backfill and refresh call this with `X-Internal-Sync-Secret`.  
- GET /api/oauth/meta/insights/sync — called by dashboard/sync with internal header.  
- GET /api/oauth/google/insights/sync — called by dashboard/sync with internal header.  

**Env:** Set `INTERNAL_SYNC_SECRET` on the server so backfill and dashboard/sync can pass it. Do not expose to the client.

---

## 4. Risks closed

- **Project data leakage:** All dashboard and sync routes now require either a valid user with project access or a valid internal secret.
- **Metrics/timeseries wrong data:** Legacy metrics fallback and RPC timeseries fallback removed; empty canonical returns empty data.
- **Summary vs chart mismatch:** Timeseries no longer falls back to RPC (which ignored sources/accountIds); both use canonical only when there is data.
- **Meta campaigns ad_accounts_id:** Meta sync sets `ad_accounts_id` on campaign upsert so new/updated campaigns are linked.
- **Payload pollution:** `project_id` removed from all `daily_ad_metrics` insert payloads (Meta + Google).

---

## 5. Risks remaining

- **Sync lock is in-process only:** With multiple app instances, parallel sync for the same range can still run. Mitigation: document single-instance for sync or add distributed lock later.
- **Race between delete and insert in sync:** Delete-then-insert remains; if the process dies after delete, data for that range can be missing until next sync. Mitigation: optional future change to upsert by (ad_account_id, campaign_id, date) where safe.
- **Legacy campaigns:** Rows with `ad_accounts_id IS NULL` still exist; NOT NULL not set. Handled by LEGACY_CAMPAIGNS_CLEANUP_STRATEGY.md and optional separate migration.
- **ad_accounts column name:** Dashboard accounts route may still select `account_name`; schema has `name`. If API returns null for name, verify column and fix in a follow-up.

---

## 6. Migrations

- **No new migrations required** for this hardening. Existing migrations (20250604–20250607) remain for dedupe and backfill.
- **Optional later:** Separate legacy cleanup migration to delete unused campaigns with `ad_accounts_id IS NULL` (see LEGACY_CAMPAIGNS_CLEANUP_STRATEGY.md). Do not combine with critical fixes.

---

## 7. Safe rollout plan

1. **Env:** Set `INTERNAL_SYNC_SECRET` to a long random string on all environments where backfill and dashboard/sync run.  
2. **Deploy:** Deploy code. Ensure dashboard and sync routes use the new auth helper and that backfill/sync send the internal header.  
3. **Smoke test:**  
   - Unauthenticated request to GET /api/dashboard/summary?project_id=... → 401.  
   - Authenticated user, own project → 200.  
   - Authenticated user, other project → 403.  
   - Summary and timeseries for same range/filters → same totals and point count when data exists; when no data, summary totals 0 and timeseries points [].  
4. **Backfill:** Trigger a range that triggers backfill (e.g. missing days). Confirm sync runs (check logs for access_source: "internal" or successful sync).  
5. **Legacy:** Run verification queries from LEGACY_CAMPAIGNS_CLEANUP_STRATEGY.md and DB_VERIFICATION_QUERIES.md; document counts. Only then consider optional legacy cleanup migration and NOT NULL.

---

## 8. Verification checklist after deploy

- [ ] All dashboard GET routes return 401 without auth when project_id is present.  
- [ ] With auth, own project_id returns 200; other project_id returns 403.  
- [ ] POST /api/dashboard/sync without auth returns 401; with auth and project access returns 200 (or 404 if no enabled accounts).  
- [ ] Backfill still triggers sync when range has missing days (INTERNAL_SYNC_SECRET set and passed).  
- [ ] GET /api/dashboard/metrics with no canonical data returns [] (not legacy table data).  
- [ ] GET /api/dashboard/timeseries with no canonical data returns `points: []` (not RPC data).  
- [ ] Summary and timeseries for same project/range/sources show consistent totals (or both zero/empty).  
- [ ] Meta sync creates/updates campaigns with `ad_accounts_id` set when canonical ad account exists.  
- [ ] No `project_id` in daily_ad_metrics insert payloads (check logs or DB if needed).  
- [ ] Logs show branch (canonical/cache), access_source (user/internal), and fallback_reason where applicable.
