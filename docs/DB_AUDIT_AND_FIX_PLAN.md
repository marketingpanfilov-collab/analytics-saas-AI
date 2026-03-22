# DB audit and fix plan — analytics-saas

## 1. Current schema (from migrations)

### campaigns
- **Source:** ALTER in 20250307000004 (ad_accounts_id), 20250307500000 (external_campaign_id), 20250308000000 (platform backfill), 20250602000000 (ensure ad_accounts_id + UNIQUE). No single CREATE TABLE in scanned migrations; table pre-exists.
- **Columns (inferred):** id (uuid PK), project_id, ad_account_id (text, legacy), ad_accounts_id (uuid NULL, FK ad_accounts), external_campaign_id (text NULL), name, platform, and possibly created_at (not guaranteed).
- **Unique/index:** Partial UNIQUE INDEX idx_campaigns_ad_accounts_external_campaign ON (ad_accounts_id, external_campaign_id) WHERE external_campaign_id IS NOT NULL (20250307500000). Non-partial constraint campaigns_ad_accounts_external_campaign_key UNIQUE (ad_accounts_id, external_campaign_id) added in 20250602000000 / 20250603000000.
- **Nullable:** ad_accounts_id and external_campaign_id are nullable (legacy/Meta rows may have NULL).

### daily_ad_metrics
- **Columns:** id (uuid PK), ad_account_id (uuid NOT NULL, FK ad_accounts), campaign_id (uuid NULL, FK campaigns), date (date NOT NULL), platform (text NOT NULL), spend, impressions, clicks, reach, cpm, cpc, ctr, leads, purchases, revenue, roas, created_at (timestamptz NOT NULL).
- **No `source` column** — only `platform`. Uniqueness is per (ad_account_id, campaign_id, date) with partial indexes:
  - Account-level: UNIQUE (ad_account_id, date) WHERE campaign_id IS NULL.
  - Campaign-level: UNIQUE (ad_account_id, campaign_id, date) WHERE campaign_id IS NOT NULL.

### ad_accounts
- **Columns:** id (uuid PK), integration_id (uuid NOT NULL), platform, platform_account_id, name, currency, account_status, is_enabled, created_at, updated_at; provider and external_account_id added in repair migration.
- **Unique:** (integration_id, platform_account_id); (integration_id, external_account_id) in later migrations.

### sync_runs
- **Columns:** id, project_id, platform, ad_account_id (uuid NULL, FK ad_accounts), sync_type, status, started_at, finished_at, rows_written, error_message, meta, created_at.

### integrations
- **Columns:** id, project_id, platform, created_at, updated_at. UNIQUE (project_id, platform).

### integrations_auth
- **Columns:** id, integration_id (UNIQUE), access_token, refresh_token, token_expires_at, scopes, meta, created_at, updated_at.

---

## 2. Found problems

### campaigns
1. **ad_accounts_id IS NULL** — legacy or failed backfill rows; count unknown without DB query.
2. **Duplicate rows for same (ad_accounts_id, trim(external_campaign_id))** — one external Google campaign mapped to two internal campaign IDs (e.g. 157ee87c..., d0ca0480...) → double spend in dashboard.
3. **external_campaign_id not normalized** — "123" vs " 123 " stored as different values; UNIQUE does not dedupe them.
4. **Previous dedupe used min(id)** — user reports this failed; need deterministic canonical via row_number() OVER (PARTITION BY ... ORDER BY created_at ASC NULLS LAST, id ASC).

### daily_ad_metrics
1. **Duplicate rows** — same (ad_account_id, campaign_id, date) or (ad_account_id, date) when campaign_id IS NULL, e.g. after remapping two campaign_ids to one without merging duplicates.
2. **Orphan rows** — campaign_id pointing to deleted or non-existent campaigns; ad_account_id to non-existent ad_accounts (FK usually prevents, but historical data may differ).
3. **No `source` column** — dedupe is by (ad_account_id, campaign_id, date) and (ad_account_id, date); platform is the only extra dimension.

### Google sync
1. **Non-deterministic mapping** — when select returns multiple rows per external_campaign_id, code used last-seen id (after sort by id); should use single canonical (e.g. first by created_at, id).
2. **Raw external_campaign_id in upsert** — if API sends " 123 ", we insert " 123 "; next run may send "123" and create a second row. Need normalize (trim) before upsert and before select match.
3. **Select by .in("external_campaign_id", keys)** — if keys are normalized but DB has unnormalized values, match can fail. Normalize in DB or in code consistently.

### Canonical dashboard
1. **Uses only campaign-level** (daily_ad_metrics_campaign) — so duplicate campaign rows or duplicate metrics rows both inflate totals.
2. **Summary vs timeseries** — must use same source and same ad_account set; already fixed in prior work (resolveAdAccountIds, no platform column break).

---

## 3. Root causes

- **Double spend:** One external Google campaign → two internal campaign rows (duplicate (ad_accounts_id, external_campaign_id) or (ad_accounts_id, trim(external_campaign_id))). Metrics written to both → same spend counted twice.
- **Duplicates in campaigns:** UNIQUE added after data existed; or external_campaign_id stored with different trim/whitespace; or sync created second row when matching by raw id failed.
- **Duplicates in daily_ad_metrics:** Remap of campaign_id from duplicate to canonical produced two rows with same (ad_account_id, campaign_id, date); dedupe step used min(id) and may have been skipped or failed.
- **ad_accounts_id NULL:** Legacy campaigns (e.g. Meta) or backfill that only matched via project_id + ad_account_id (text) and did not set ad_accounts_id.

---

## 4. What will be fixed by SQL migrations

| # | Migration | Fix |
|---|-----------|-----|
| 1 | campaigns_ensure_created_at | ADD COLUMN IF NOT EXISTS created_at timestamptz DEFAULT now() so deterministic dedupe (order by created_at, id) is possible. |
| 2 | campaigns_google_dedupe_deterministic | Find Google campaign duplicates by (ad_accounts_id, trim(external_campaign_id)). Canonical = row_number() OVER (PARTITION BY ad_accounts_id, trim(external_campaign_id) ORDER BY created_at ASC NULLS LAST, id ASC) = 1. Remap daily_ad_metrics.campaign_id to canonical; delete duplicate campaign rows. Idempotent. No min(uuid). |
| 3 | daily_ad_metrics_dedupe | Dedupe by (ad_account_id, campaign_id, date) and (ad_account_id, date) keeping one row per group via row_number() ORDER BY created_at ASC, id ASC; delete others. |
| 4 | campaigns_ad_accounts_id_null_audit | Report campaigns with ad_accounts_id IS NULL (used vs unused in daily_ad_metrics). Optionally: backfill ad_accounts_id from matching campaign by trim(external_campaign_id) + platform where possible; delete only unused and unrecoverable; do NOT set NOT NULL if any remain. |
| 5 | campaigns_unique_normalized (optional) | If safe: expression unique index or constraint for (ad_accounts_id, trim(external_campaign_id)) for Google to prevent trim-duplicates. Document if not applied. |

---

## 5. What will be fixed in sync code

- **Google sync (app/api/oauth/google/insights/sync/route.ts):**
  - Normalize all external_campaign_id: `normalizedExternalCampaignId = trim(String(extId)) || ""; if (normalizedExternalCampaignId === "") treat as null / skip.`
  - Upsert with normalized value only.
  - Select campaigns by normalized list; when building externalToCampaignId, use first row per normalized id (sort by id or created_at) so one external → one internal.
  - Log: raw campaign ids from API, normalized ids, count in DB, count matched, count dropped and reason (e.g. "no_campaigns_in_db_after_upsert", "api_ids_not_matched").
  - If prepared rows = 0 but API returned campaigns, log explicit reason (e.g. "all rows dropped: externalToCampaignId empty").
- **Meta sync:** Ensure it does not insert duplicate (ad_account_id, campaign_id, date) or (ad_account_id, date) — either upsert with ON CONFLICT or delete-then-insert in same transaction. No change if already correct.

---

## 6. Post-fix checks

- Run verification SQL from docs/DB_VERIFICATION_QUERIES.md: no duplicate campaigns by normalized external_campaign_id; no duplicate daily_ad_metrics; orphan counts; spend totals.
- Dashboard: all sources / google / meta for 2026-02-01 → 2026-03-16; single day 2026-03-16; summary and timeseries consistent.
- Count of campaigns with ad_accounts_id IS NULL; decision on NOT NULL constraint documented.

---

## 7. Risks and safe approach

- **Risk:** Deleting campaign rows that are still referenced. **Mitigation:** Only delete after remapping daily_ad_metrics to canonical campaign_id.
- **Risk:** created_at missing on campaigns. **Mitigation:** ADD COLUMN IF NOT EXISTS created_at DEFAULT now(); existing rows get same default; ordering by (created_at, id) remains deterministic.
- **Risk:** Legacy campaigns with ad_accounts_id NULL and no way to resolve. **Mitigation:** Do not delete them automatically; report in audit; optional legacy cleanup migration later.
- **No min(uuid):** All canonical picks via row_number() OVER (... ORDER BY created_at ASC NULLS LAST, id ASC) and keep rn = 1. Migration 20250603000000 used array_agg(id ORDER BY id)[1]; 20250605000000 replaces with deterministic row_number/created_at/id.

### Legacy migration note
- **20250603000000_google_campaign_dedupe.sql** uses array_agg(c.id ORDER BY c.id)[1] (equivalent to min(id)). If that migration failed or was reverted, 20250604000000 + 20250605000000 + 20250606000000 provide the deterministic fix. If 20250603000000 already ran, 20250605000000 is idempotent and will fix any remaining trim-duplicates or re-canonicalize by created_at.

---

## 8. Final report (after applying migrations)

### Files changed
- **docs/DB_AUDIT_AND_FIX_PLAN.md** — audit, root causes, plan, legacy note.
- **docs/DB_VERIFICATION_QUERIES.md** — SQL for post-fix verification.
- **app/api/oauth/google/insights/sync/route.ts** — normalized external_campaign_id (trim), deterministic one external → one internal (select all Google campaigns for ad_accounts_id, build map by trim(ext) → first id by id sort), logs: normalized_external_ids, pipeline steps.

### Migrations created
| Migration | Purpose |
|-----------|---------|
| 20250604000000_campaigns_ensure_created_at.sql | ADD COLUMN IF NOT EXISTS created_at on campaigns for deterministic dedupe. |
| 20250605000000_campaigns_google_dedupe_deterministic.sql | Google campaign dedupe via row_number() ORDER BY created_at, id; remap daily_ad_metrics; delete duplicate campaigns; ensure UNIQUE constraint. |
| 20250606000000_daily_ad_metrics_dedupe.sql | Dedupe daily_ad_metrics by (ad_account_id, campaign_id, date) keeping one row per group (row_number ORDER BY created_at, id). |
| 20250607000000_campaigns_ad_accounts_id_null_audit.sql | Backfill ad_accounts_id where single match by (project_id, platform, trim(external_campaign_id)); optional delete of unused nulls commented out; no NOT NULL. |

### What was fixed
- **Campaigns:** Deterministic canonical row per (ad_accounts_id, trim(external_campaign_id)) via row_number(); metrics remapped to canonical; duplicate campaign rows removed; UNIQUE (ad_accounts_id, external_campaign_id) ensured.
- **daily_ad_metrics:** One row per (ad_account_id, campaign_id, date); duplicates removed by row_number() ORDER BY created_at, id (no min(uuid)).
- **ad_accounts_id NULL:** Backfill where exactly one matching campaign exists; no mass delete of used rows; NOT NULL not set.
- **Google sync:** External id normalized (trim, empty → skip); select all Google campaigns for ad_accounts_id then build map by normalized key so DB values with spaces still match; one external → one internal (first by id).

### Constraints/indexes added
- campaigns: UNIQUE campaigns_ad_accounts_external_campaign_key (ad_accounts_id, external_campaign_id) — idempotent in 20250605000000.
- campaigns: created_at column (20250604000000).
- daily_ad_metrics: existing partial UNIQUE indexes (account-level and campaign-level) unchanged; dedupe removes duplicate rows so indexes can be enforced.

### Duplicates removed / remapped
- Counts depend on DB state; run verification queries 1, 4, 5 to confirm 0 duplicate campaigns and 0 duplicate metrics after migrations.

### campaigns with ad_accounts_id IS NULL after cleanup
- Run verification query 2; if count > 0, do NOT set NOT NULL. Document in audit.

### NOT NULL on campaigns.ad_accounts_id
- Only safe after verification shows 0 nulls. If any remain (legacy/unmatched), do not run ALTER; document and optionally add legacy migration later for manual cleanup.

### SQL for final verification
- See **docs/DB_VERIFICATION_QUERIES.md**: queries 1–9 (duplicate campaigns, null ad_accounts_id, orphan metrics, duplicate metrics, spend totals, single day).

### Dashboard ranges to check manually
- **All sources:** 2026-02-01 → 2026-03-16.
- **Google only:** 2026-02-01 → 2026-03-16.
- **Meta only:** 2026-02-01 → 2026-03-16.
- **Single day:** 2026-03-16.
- Confirm summary and timeseries use same path (canonical) and totals are stable (no double spend).
