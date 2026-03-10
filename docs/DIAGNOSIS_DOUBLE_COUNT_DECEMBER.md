# Diagnosis: Dashboard double-count (December totals)

## Observed

- **December campaign-level total (dashboard):** spend = 4896.27, impressions = 2915505, clicks = 30083  
- **Previously account-level totals:** spend = 2681.31, impressions = 1643530, clicks = 17939  
- **Meta Ads Manager visible:** spend = 2214.96  

**Key fact:** 4896.27 = 2681.31 + 2214.96 exactly → suggests **account-level + campaign-level** are being summed together.

---

## Code inspection

### 1. Account-level rows still in `daily_ad_metrics`?

**Yes.** In `app/api/oauth/meta/insights/sync/route.ts`:

- **Section A (lines ~363–421):** Still inserts **account-level** rows:
  - `campaign_id: null`
  - Delete: `ad_account_id = X AND campaign_id IS NULL AND date IN (dates)`
  - Insert: one row per day with account totals from Meta account-level insights

- **Section B (campaign loop):** Inserts **campaign-level** rows with non-null `campaign_id`.

So after a full sync, the table contains **both**:
- Rows with `campaign_id IS NULL` (account-level)
- Rows with `campaign_id IS NOT NULL` (campaign-level)

### 2. Campaign-level insert duplicating account totals?

**No.** Campaign-level insert uses only Meta **campaign** insights (`level: "campaign"`, `entity_id: i.campaign_id`). Each row is per (campaign, date). There is no code path that assigns account totals to campaign rows. Sum of campaign rows should match Meta Ads Manager (campaign breakdown), not account + campaign.

### 3. Does `dashboardCanonical` aggregate both levels?

**Intended: no. Implemented: possibly yes.**

- **Single read path:** `fetchCanonicalRowsViaJoin()` in `app/lib/dashboardCanonical.ts` (lines 40–99).
- **Filter used:** `.not("campaign_id", "is", null)` (line 74) → intended SQL: `WHERE campaign_id IS NOT NULL`.
- **If that filter is ignored or wrong** (e.g. PostgREST/Supabase client with UUID, or `.not()` behavior), the query could return **all** rows. Then we would sum:
  - account-level rows (2681.31) +
  - campaign-level rows (2214.96)  
  = 4896.27.

So the double-count is **consistent with the read path including both account and campaign rows**, despite the intended filter.

### 4. Is `campaign_id` assigned to account-total rows?

**No.** Account-level insert explicitly sets `campaign_id: null`. Campaign-level insert sets `campaign_id` from `entityIdToCampaignId.get(entity_id)` (UUID from `campaigns.id`). No logic assigns a campaign_id to account totals.

### 5. Delete-before-insert leaving duplicated rows?

**No.**  
- Account: delete `ad_account_id = X AND campaign_id IS NULL AND date IN (dates)` then insert account rows for those dates.  
- Campaign: per chunk, delete `ad_account_id = X AND campaign_id IN (chunk_ids) AND date BETWEEN chunk_start AND chunk_end` then insert chunk.  

So we don’t leave old duplicated rows behind; we do leave **both** account-level and campaign-level rows in the table (by design in current code).

---

## Root cause (conclusion)

1. **Duplication is in the read, not in the ingestion.**  
   - Ingestion: account-level and campaign-level are written separately; campaign-level rows are not filled with account totals.  
   - The equality 4896.27 = 2681.31 + 2214.96 implies the dashboard is summing **both** account-level and campaign-level rows.

2. **Likely cause:** The Supabase/PostgREST filter `.not("campaign_id", "is", null)` is not excluding `campaign_id IS NULL` rows (e.g. UUID column or client behavior), so the dashboard effectively aggregates **all** `daily_ad_metrics` rows in the range instead of only campaign-level.

3. **Minimal fix (once confirmed by SQL):**  
   - **Option A (preferred):** Stop writing account-level rows to `daily_ad_metrics` when campaign-level data exists for the same period (single source of truth = campaign-level; backfill/coverage can stay or be switched to campaign-level).  
   - **Option B:** Keep both levels in the DB but fix the read: enforce “campaign-level only” in SQL (e.g. RPC or view that applies `WHERE campaign_id IS NOT NULL`) so the dashboard never sums account-level rows.

---

## SQL checks (run these)

Run in the Supabase SQL editor (replace date range if needed).

### Account-level vs campaign-level totals for December

```sql
-- Account-level totals (campaign_id IS NULL)
SELECT
  'account' AS level,
  sum(spend) AS spend,
  sum(impressions) AS impressions,
  sum(clicks) AS clicks,
  count(*) AS row_count
FROM daily_ad_metrics
WHERE campaign_id IS NULL
  AND date BETWEEN '2025-12-01' AND '2025-12-31';

-- Campaign-level totals (campaign_id IS NOT NULL)
SELECT
  'campaign' AS level,
  sum(spend) AS spend,
  sum(impressions) AS impressions,
  sum(clicks) AS clicks,
  count(*) AS row_count
FROM daily_ad_metrics
WHERE campaign_id IS NOT NULL
  AND date BETWEEN '2025-12-01' AND '2025-12-31';

-- Combined (what the dashboard would show if it summed ALL rows)
SELECT
  'all' AS level,
  sum(spend) AS spend,
  sum(impressions) AS impressions,
  sum(clicks) AS clicks,
  count(*) AS row_count
FROM daily_ad_metrics
WHERE date BETWEEN '2025-12-01' AND '2025-12-31';
```

Interpretation:  
- If “all” spend ≈ 4896.27 and “account” + “campaign” spend ≈ 2681.31 + 2214.96, then the dashboard is summing both levels (read-side double-count).  
- If “campaign” spend alone ≈ 4896.27, then the double-count would be in ingestion (campaign rows containing account totals); code review suggests this is not the case.

### Distinct campaign_id count for December

```sql
SELECT count(DISTINCT campaign_id) AS distinct_campaigns
FROM daily_ad_metrics
WHERE campaign_id IS NOT NULL
  AND date BETWEEN '2025-12-01' AND '2025-12-31';
```

### Sample rows (December, ordered by date and campaign_id)

```sql
SELECT
  date,
  ad_account_id,
  campaign_id,
  spend,
  impressions,
  clicks
FROM daily_ad_metrics
WHERE date BETWEEN '2025-12-01' AND '2025-12-31'
ORDER BY date, campaign_id NULLS FIRST
LIMIT 50;
```

Check: you should see rows with `campaign_id IS NULL` (account) and rows with UUID (campaign). If the dashboard sums all of these, you get the double-count.

---

## Summary

| Question | Answer |
|----------|--------|
| 1. Account-level rows still in `daily_ad_metrics`? | **Yes** – sync still writes them. |
| 2. Campaign-level insert duplicating account totals? | **No** – campaign rows come only from campaign insights. |
| 3. `dashboardCanonical` aggregating both levels? | **Intended: no** (filter: campaign only). **Likely actual: yes** if `.not("campaign_id","is",null)` does not exclude nulls. |
| 4. `campaign_id` on account-total rows? | **No** – account rows have `campaign_id` null. |
| 5. Delete-before-insert leaving duplicates? | **No** – deletes are scoped correctly. |

**Root cause:** Double-count is almost certainly in the **read**: dashboard is summing both account-level and campaign-level rows.  
**Minimal fix:** Either (A) stop writing account-level to `daily_ad_metrics` when campaign-level exists, or (B) enforce campaign-only aggregation in SQL (RPC/view) and use that for the dashboard.

Run the SQL above to confirm the “account” + “campaign” sums and “all” sum before applying the chosen fix.
