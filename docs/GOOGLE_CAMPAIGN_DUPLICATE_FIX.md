# Fix: Duplicate Google campaign-level metrics (one external → two internal campaign IDs)

## Root cause

Two internal campaign rows (e.g. `157ee87c-cb2f-4808-8c94-63c250a6716d` and `d0ca0480-1f15-4076-b37e-287e55c62ecf`) existed for the same Google ad account (`ad_accounts_id = 3f286744-7c71-4c1e-a304-2379eb158e05`), both with the same (or effectively same) **external_campaign_id**. That led to:

- **daily_ad_metrics** containing two rows for the same (ad_account_id, date) with identical metrics (spend, impressions, clicks) but different **campaign_id**.
- Dashboard double-counting spend for `sources=google` (e.g. 1.579773 counted twice → ~1.58 delta).

**Why two internal campaign rows for one external campaign?**

1. **UNIQUE constraint applied after data existed**  
   The non-partial UNIQUE on `(ad_accounts_id, external_campaign_id)` was added in migration `20250602000000`. If two rows with the same `(ad_accounts_id, external_campaign_id)` were inserted earlier (e.g. by different sync runs or before the constraint), both remained.

2. **Different string representation of the same external id**  
   e.g. `"123"` vs `" 123 "` or different casing. The DB stores them as different values, so the UNIQUE constraint did not prevent the second row. After normalization (trim), they are the same external campaign.

3. **Select after upsert returning multiple rows**  
   Sync does `select ... in("external_campaign_id", keys)`. If the table had two rows for the same external id, both were returned. The code then did `externalToCampaignId.set(ext, c.id)` so the last id won; different sync runs or order could write metrics to different campaign_ids, or both could receive inserts in different runs.

## What was done

### 1. Migration `20250603000000_google_campaign_dedupe.sql`

- **Find duplicates**  
  Groups `campaigns` by `(ad_accounts_id, trim(external_campaign_id))` for `platform = 'google'` and selects groups with `count(*) > 1`.

- **Canonical id**  
  For each group, canonical = `min(id)` (deterministic).

- **Remap daily_ad_metrics**  
  For each duplicate campaign id in the group, `UPDATE daily_ad_metrics SET campaign_id = canonical_id` where `ad_account_id = ad_accounts_id` and `campaign_id = duplicate_id`.

- **Delete duplicate campaign rows**  
  Delete from `campaigns` all rows in the group except the canonical one.

- **Dedupe daily_ad_metrics**  
  After remap, there can be two rows with same `(ad_account_id, campaign_id, date)`. Delete all but one (keep `min(id)` per group) so each (ad_account_id, campaign_id, date) appears once.

- **Ensure UNIQUE constraint**  
  Idempotent add of `campaigns_ad_accounts_external_campaign_key` UNIQUE on `(ad_accounts_id, external_campaign_id)` so future upserts cannot create duplicate campaigns.

### 2. Google sync `app/api/oauth/google/insights/sync/route.ts`

- **One external → one internal when building the map**  
  After `select` from `campaigns`, sort by `id` and use `if (!externalToCampaignId.has(ext)) externalToCampaignId.set(ext, c.id)` so the first (smallest) id wins. That makes the mapping deterministic and aligned with the canonical id chosen in the migration.

- **Normalize external id when building the map**  
  Use `String(c.external_campaign_id).trim()` so `" 123 "` and `"123"` map to the same internal campaign.

## SQL verification

### Inspect campaigns for the two suspicious IDs

```sql
SELECT id, ad_accounts_id, external_campaign_id, name, platform, project_id
FROM public.campaigns
WHERE id IN (
  '157ee87c-cb2f-4808-8c94-63c250a6716d',
  'd0ca0480-1f15-4076-b37e-287e55c62ecf'
);
```

Before fix: both rows exist, same `ad_accounts_id`, same (or trim-equal) `external_campaign_id`.  
After fix: only one row remains (canonical).

### Find all duplicate campaigns for this ad account (before migration)

```sql
SELECT
  ad_accounts_id,
  trim(coalesce(external_campaign_id, '')) AS ext_norm,
  count(*) AS cnt,
  array_agg(id ORDER BY id) AS campaign_ids
FROM public.campaigns
WHERE ad_accounts_id = '3f286744-7c71-4c1e-a304-2379eb158e05'
  AND platform = 'google'
  AND external_campaign_id IS NOT NULL
GROUP BY ad_accounts_id, trim(coalesce(external_campaign_id, ''))
HAVING count(*) > 1;
```

After migration: this returns no rows.

### daily_ad_metrics for this ad account and date (before/after)

```sql
SELECT campaign_id, date, spend, impressions, clicks
FROM public.daily_ad_metrics
WHERE ad_account_id = '3f286744-7c71-4c1e-a304-2379eb158e05'
  AND campaign_id IS NOT NULL
  AND date = '2026-03-01'
ORDER BY campaign_id;
```

Before fix: two rows (same spend/impressions/clicks, different campaign_id).  
After fix: one row per (campaign_id, date).

### Dashboard totals (Google) before/after

```sql
SELECT
  count(*) AS row_count,
  count(distinct date) AS points_count,
  sum(spend) AS spend
FROM daily_ad_metrics d
WHERE d.ad_account_id = '3f286744-7c71-4c1e-a304-2379eb158e05'
  AND d.campaign_id IS NOT NULL
  AND d.date >= '2026-02-01' AND d.date <= '2026-03-15';
```

After fix: `spend` should drop by the duplicated amount (~1.579773) so that Google dashboard totals match actual (no double-count). `row_count` and `points_count` will also decrease by the number of duplicate rows removed.

## Files changed

- **supabase/migrations/20250603000000_google_campaign_dedupe.sql** — new migration: find duplicate campaigns, remap daily_ad_metrics to canonical campaign_id, dedupe daily_ad_metrics, delete duplicate campaigns, ensure UNIQUE.
- **app/api/oauth/google/insights/sync/route.ts** — build `externalToCampaignId` from sorted list; use first (min id) per trimmed external_campaign_id; normalize with `.trim()`.
- **docs/GOOGLE_CAMPAIGN_DUPLICATE_FIX.md** — this document.

## Recompute dashboard and verify

1. Apply migration: `npx supabase db push` or run the migration SQL.
2. Reload dashboard for 2026-02-01 → 2026-03-15 with `sources=google,direct,organic_search,referral`.
3. Confirm that the Google spend delta (~1.579773) is gone and totals are consistent with a single row per (ad_account_id, campaign_id, date).
