# Backend hardening pass 2 — production stability

**Date:** 2026-03-06  
**Scope:** DB verification clarity, sync reliability, multi-instance safety, legacy cleanup strategy, backend consistency, schema/code fixes.

---

## 1. Verify DB checks

### Orphan metrics (correct logic)

- **Campaign-level orphan:** Rows in `daily_ad_metrics` where `campaign_id IS NOT NULL` and that `campaign_id` does not exist in `campaigns`. Account-level rows (`campaign_id IS NULL`) are **not** “orphan campaign” rows and must not be counted as such.
- **Ad-account orphan:** Any row in `daily_ad_metrics` whose `ad_account_id` is not in `ad_accounts` (applies to both campaign- and account-level).

Queries in **DB_VERIFICATION_QUERIES.md** §3 were updated to make this explicit and to use distinct labels (`orphan_campaign_level`, `orphan_ad_account`).

### Duplicate checks (unchanged, already correct)

- **§4:** Duplicate campaign-level: `(ad_account_id, campaign_id, date)` with `campaign_id IS NOT NULL` → expect 0 rows.
- **§5:** Duplicate account-level: `(ad_account_id, date)` with `campaign_id IS NULL` → expect 0 rows.
- **§1:** Duplicate Google campaigns by normalized `(ad_accounts_id, trim(external_campaign_id))` → expect 0 rows.

### Summary: what should be 0 vs may be > 0

| Check | Expected | If not 0 |
|-------|----------|----------|
| §1 Duplicate Google campaigns | 0 rows | Re-run deterministic dedupe migration or fix UNIQUE/trim. |
| §3 Orphan campaign-level | 0 | Fix or remap invalid `campaign_id` references. |
| §3 Orphan ad_account | 0 | Fix `ad_accounts` or remap metrics. |
| §4 Duplicate campaign-level metrics | 0 rows | Re-run daily_ad_metrics dedupe migration. |
| §5 Duplicate account-level metrics | 0 rows | Re-run daily_ad_metrics dedupe migration. |
| §2 / §9 Campaigns with ad_accounts_id IS NULL | May be > 0 | Legacy; see legacy strategy. Do **not** set NOT NULL until 0. |

**How to run:** Execute queries in `docs/DB_VERIFICATION_QUERIES.md` (§1, §3, §4, §5, §2, §9) and record results. Section 10 in that doc summarizes the same table.

---

## 2. Sync reliability

### Current flow: delete-then-insert

- **Meta:** For account-level: delete `daily_ad_metrics` for `(ad_account_id, date IN dates)` where `campaign_id IS NULL`, then insert new rows. For campaign-level: delete for `(ad_account_id, campaign_id IN ids, date BETWEEN chunkStart AND chunkEnd)`, then insert. Zero-fill: insert zero rows for missing dates. Fallback: when no account-level API data, aggregate campaign-level and write account-level.
- **Google:** Same pattern: delete account-level for dates, insert; delete campaign-level for (ad_account_id, campaign_ids, date range), insert; zero-fill for missing dates.
- **Transaction boundaries:** No explicit transaction wrapping delete + insert. Each is a separate round-trip.

### Risk: process dies between delete and insert

- **Impact:** For that sync run’s date range, data is removed and not reinserted → temporary undercount until next successful sync.
- **Likelihood:** Low under normal operation; higher under OOM, kill, or deployment during sync.
- **Mitigation (current):** Re-running sync for the same range repopulates data (idempotent per run). No partial duplicate rows because delete clears the range first.
- **Recommendation:** Document the risk; optional later improvement: wrap delete+insert in a single DB transaction or move to upsert (see below). Not changed in this pass to avoid behavioral changes.

### Target upsert-based model (for future migration path)

- **Conflict keys:**
  - Campaign-level: `(ad_account_id, campaign_id, date)` with partial unique index `WHERE campaign_id IS NOT NULL`.
  - Account-level: `(ad_account_id, date)` with partial unique index `WHERE campaign_id IS NULL`.
- **Uniqueness:** Already enforced by existing partial unique indexes in 20250307000005. Upsert would use `ON CONFLICT (ad_account_id, campaign_id, date)` for campaign-level (with conflict target matching the partial index) and `ON CONFLICT (ad_account_id, date)` for account-level where `campaign_id IS NULL` (PostgreSQL allows partial unique index as conflict target).
- **Transaction boundaries:** Prefer one transaction per “logical write” (e.g. one account-level batch + one campaign-level batch per account) so that a crash leaves either old or new state, not empty.
- **Safe migration path:** (1) Keep current delete-then-insert. (2) Add a feature flag or sync-mode: “upsert”. (3) Implement upsert path: for each batch, `INSERT INTO daily_ad_metrics (...) ON CONFLICT (...) DO UPDATE SET spend = EXCLUDED.spend, ...`. (4) Run in staging; compare totals with delete-then-insert. (5) Switch default to upsert; deprecate delete-then-insert after verification. No change applied in this pass.

---

## 3. Multi-instance safety (distributed lock)

### Current state

- **syncLock.ts:** In-process `Map` keyed by `platform:ad_account_id:date_start:date_end:sync_type`. Only prevents concurrent sync for the same key within the same Node process. With multiple instances (e.g. Vercel/serverless or multiple pods), two requests can run the same sync in parallel → duplicate deletes/inserts or constraint violations.

### Options

| Option | Pros | Cons |
|--------|------|------|
| **PostgreSQL advisory lock** | No new infra; same DB as data; `pg_advisory_xact_lock(key_hash)` per sync key. | Requires a dedicated DB connection or session for the duration of sync (serverless may not hold long). Lock released on commit/rollback. |
| **Redis lock** | Fast; TTL avoids stuck locks; common pattern. | New dependency; need Redis (e.g. Upstash) and client. |
| **sync_runs state lock** | Uses existing table; “running” row per (project_id, ad_account_id, platform, sync_type) with `started_at`; second caller skips or waits. | Need to define “same range” (e.g. overlapping dates); polling or backoff; cleanup of stale “running” rows. |

### Recommendation: PostgreSQL advisory lock

- **Why:** No new infrastructure; project already uses Supabase/PostgreSQL. Sync runs are per (platform, ad_account_id, range); a single advisory lock per key for the duration of the sync is sufficient. Use `pg_try_advisory_xact_lock(key_bigint)` so that if lock cannot be acquired, sync returns “already running” instead of blocking indefinitely.
- **Key derivation:** Hash `platform:ad_account_id:date_start:date_end:insights` to a bigint (e.g. use pg’s `hashtext` or a deterministic 64-bit hash in app and pass to advisory lock).
- **Implementation sketch:** (1) At start of Meta/Google sync (inside `withSyncLock`), open a transaction or use a single long-lived connection; call `SELECT pg_try_advisory_xact_lock(hashtext(key))` (or equivalent). (2) If false, return 409 or “sync already in progress” for that key. (3) If true, run existing sync logic; release at transaction end. (4) For serverless, consider a dedicated “sync worker” that holds the connection, or use a short lock window and “claim” sync_runs row with advisory lock for the claim. Not implemented in this pass; document for next iteration.

**No code change in this pass;** recommendation only.

---

## 4. Legacy campaigns cleanup

### Categories (aligned with LEGACY_CAMPAIGNS_CLEANUP_STRATEGY.md)

1. **Referenced by metrics**  
   `campaigns.id` appears in `daily_ad_metrics.campaign_id`.  
   **Action:** Do not delete. Backfill `ad_accounts_id` if exactly one match exists (20250607000000); otherwise leave as legacy until manual remap or one-off script.

2. **Not referenced anywhere**  
   `ad_accounts_id IS NULL` and no row in `daily_ad_metrics` has `campaign_id = c.id`.  
   **Action:** Safe to delete in a **separate** migration after backup. Optional migration: e.g. `20250608000000_legacy_campaigns_delete_unused.sql` with a commented DELETE and reminder to run verification first.

3. **Can be backfilled**  
   Exactly one campaign with same `(project_id, platform, trim(external_campaign_id))` has non-null `ad_accounts_id`.  
   **Action:** Already done in 20250607000000. Re-run if new data appeared.

### Safe cleanup strategy

- **Delete:** Only rows in category “not referenced anywhere”. Run verification query (LEGACY_CAMPAIGNS_CLEANUP_STRATEGY.md) before and after.
- **Leave:** All rows referenced by metrics that cannot be backfilled.
- **Backfill:** Use 20250607000000; do not add NOT NULL on `ad_accounts_id` until count of nulls is 0 and verified.

No new migration added; strategy and verification SQL remain in LEGACY_CAMPAIGNS_CLEANUP_STRATEGY.md.

---

## 5. Backend consistency pass

### Sources filtering

- **Canonical (summary, timeseries, metrics):** `dashboardCanonical.ts` → `normalizeSources(sources)` (lowercase, trim, allow meta/google/tiktok/yandex) → `resolveAdAccountIds(..., sources, accountIds)` → filter by `provider` and optional `accountIds`. Same for all three.
- **KPI / timeseries-conversions:** Filter by `sources` on conversion rows (platform + source_class); no canonical layer. Same logic in both (platformHit || classHit).
- **Conclusion:** Paid spend endpoints use the same canonical layer and same source/accountIds semantics. Conversion endpoints use the same conversion filtering. No mismatch found.

### accountIds filtering

- Passed through from route to `getCanonicalSummary` / `getCanonicalTimeseries` / `getCanonicalMetrics` as `options.accountIds` and applied in `resolveAdAccountIds`. Same in summary, timeseries, metrics.

### Date normalization

- All dashboard routes that take start/end use a shared pattern: `toISODate(searchParams.get("start"))` (YYYY-MM-DD). Metrics uses `defaultDateRange()` when start/end missing but still requires project_id and then uses range. No inconsistency found.

### Remaining mismatch risks

- None identified. Summary, timeseries, and metrics all use the same canonical path and cache key (project_id, start, end, sourcesKey, accountIdsKey). RPC/legacy fallbacks were removed in pass 1.

---

## 6. Small schema/code inconsistencies

### account_name vs name

- **Schema:** `ad_accounts` has `name` (20250307000003). No `account_name` in migrations.
- **Fix applied:** `app/api/dashboard/accounts/route.ts` now selects `name` and orders by `name`; response still returns `name` for the account display name. This fixes potential null/undefined from selecting a non-existent column.

### site_id vs project_id

- **Usage:** `visit_source_events` has `site_id`; `conversion_events` has `project_id`. In dashboard routes (KPI, timeseries-conversions, source-options), `.eq("site_id", projectId)` is used for visit_source_events, i.e. site_id is used as project identifier.
- **Conclusion:** Semantic equivalence (site_id = project_id for this app). No code change; documented here. Future schema unification could rename `site_id` → `project_id` in a migration and update code in one pass.

### Insert/select payloads

- Pass 1 already removed `project_id` from all `daily_ad_metrics` insert payloads (Meta and Google). No further drift found in sync routes. No change in this pass.

---

## 7. Output

### List of changed files

| File | Change |
|------|--------|
| `docs/DB_VERIFICATION_QUERIES.md` | Clarified orphan check (§3): only campaign-level rows checked for orphan campaign; added §10 summary table. |
| `app/api/dashboard/accounts/route.ts` | Select and order by `name` instead of `account_name`; response uses `a.name`. |
| `docs/BACKEND_HARDENING_PASS2_REPORT.md` | New: this report. |

### SQL checks and how to interpret results

Run in order; record counts.

| # | Check | Query location | Expected | Action if not 0 |
|---|--------|----------------|----------|------------------|
| 1 | Duplicate Google campaigns | §1 | 0 rows | Fix dedupe/UNIQUE. |
| 2 | Orphan campaign-level | §3 first query | 0 | Remap or fix campaign_id. |
| 3 | Orphan ad_account | §3 second query | 0 | Fix ad_accounts / remap. |
| 4 | Duplicate campaign-level metrics | §4 | 0 rows | Re-run metrics dedupe. |
| 5 | Duplicate account-level metrics | §5 | 0 rows | Re-run metrics dedupe. |
| 6 | Campaigns ad_accounts_id IS NULL | §2 / §9 | Count | See legacy strategy; do not NOT NULL. |

### List of remaining risks

- **Sync:** Process crash between delete and insert leaves range empty until next sync. Mitigation: re-run sync; optional future: upsert or transaction.
- **Multi-instance:** In-process sync lock only; parallel instances can run same sync. Mitigation: recommend PostgreSQL advisory lock (see §3).
- **Legacy campaigns:** Rows with `ad_accounts_id IS NULL` may remain; NOT NULL not set until safe.
- **site_id naming:** Different from project_id in schema; semantic equivalence documented; rename is optional later.

### Recommended next migrations (optional)

1. **Legacy cleanup (optional):** `20250608000000_legacy_campaigns_delete_unused.sql` — DELETE campaigns where `ad_accounts_id IS NULL` and not referenced in `daily_ad_metrics`. Only after verification and backup.
2. **NOT NULL (only when safe):** After legacy cleanup and verification that count = 0: `ALTER TABLE campaigns ALTER COLUMN ad_accounts_id SET NOT NULL;` in a separate migration.

No upsert or advisory-lock migrations in this pass; only documented.

### Short rollout checklist

- [ ] Run DB_VERIFICATION_QUERIES §1, §3, §4, §5, §2, §9; record results.
- [ ] Confirm orphan_campaign_level and orphan_ad_account are 0 (or remediate).
- [ ] Confirm duplicate metrics (§4, §5) are 0 (or re-run dedupe).
- [ ] Deploy accounts route fix (name vs account_name).
- [ ] (Optional) Run legacy cleanup migration after backup and verification.
- [ ] (Later) Consider advisory lock or upsert path per this report.

### Production readiness status

- **Verdict:** **Stable for production** with known, documented limitations.
- **Strengths:** Access control and canonical-only aggregation (pass 1); clear DB checks and orphan logic; no dangerous fallbacks; consistent dashboard filtering and date handling; safe legacy strategy and no destructive cleanup without verification.
- **Acceptable risks:** Delete-then-insert sync (recoverable by re-sync); in-process lock (acceptable for single-instance; document need for distributed lock if scaling). Legacy nulls and site_id naming are cosmetic/schema only.
- **Recommendation:** Ship as-is. Plan advisory lock (or Redis) and optional upsert path for a future iteration when multi-instance or crash resilience becomes a priority.
