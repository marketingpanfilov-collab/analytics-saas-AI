# Legacy campaigns (ad_accounts_id IS NULL) — cleanup strategy

**Purpose:** Safe categorization and cleanup plan. Do not set `NOT NULL` on `campaigns.ad_accounts_id` until cleanup is verified.

## Categories

Run the verification queries below to classify rows.

### 1. Can be remapped (backfill)

- **Condition:** Exactly one other campaign row exists with same `(project_id, platform, trim(external_campaign_id))` and non-null `ad_accounts_id`.
- **Action:** Migration 20250607000000 already backfills `ad_accounts_id` from that single match. Re-run or extend if needed.
- **Check:** `SELECT count(*) FROM campaigns WHERE ad_accounts_id IS NULL` after backfill; expect decrease.

### 2. Can be deleted (unused)

- **Condition:** `ad_accounts_id IS NULL` and campaign `id` is not referenced in `daily_ad_metrics.campaign_id`.
- **Action:** Optional DELETE in a **separate** migration (e.g. `20250608000000_legacy_campaigns_cleanup_unused.sql`) after backup.
- **Risk:** Low if verification confirms zero references. Prefer soft-delete or “archived” flag if schema allows.

### 3. Leave as legacy (used, cannot remap)

- **Condition:** Referenced in `daily_ad_metrics` but no unique match for backfill (e.g. multiple ad_accounts for same external id, or missing ad_accounts row).
- **Action:** Do **not** delete. Document and leave; optionally add a `legacy = true` or comment. Do **not** set `NOT NULL` on `ad_accounts_id` until these are resolved manually or by a one-off script.

## Verification SQL (run before/after cleanup)

```sql
-- Count nulls
SELECT count(*) AS campaigns_null_ad_accounts_id
FROM public.campaigns
WHERE ad_accounts_id IS NULL;

-- Used in metrics (do not delete without remap)
SELECT c.id, c.project_id, c.platform, c.external_campaign_id, c.name,
       (SELECT count(*) FROM public.daily_ad_metrics m WHERE m.campaign_id = c.id) AS metrics_count
FROM public.campaigns c
WHERE c.ad_accounts_id IS NULL
ORDER BY metrics_count DESC;

-- Unused (candidates for optional delete)
SELECT c.id, c.project_id, c.platform, c.external_campaign_id
FROM public.campaigns c
WHERE c.ad_accounts_id IS NULL
  AND NOT EXISTS (SELECT 1 FROM public.daily_ad_metrics m WHERE m.campaign_id = c.id);
```

## NOT NULL decision

- Only run `ALTER TABLE public.campaigns ALTER COLUMN ad_accounts_id SET NOT NULL` when:
  - All verification queries above have been run.
  - Count of `ad_accounts_id IS NULL` is 0 (or only unused rows were removed in a dedicated migration).
  - Backup and a short maintenance window are acceptable.

## Recommended order

1. Apply 20250607000000 (backfill where single match exists).
2. Run verification queries; document counts and “used vs unused”.
3. If desired: add a **separate** migration that only deletes unused legacy campaigns (with comment and backup reminder).
4. Re-run verification; only then consider NOT NULL.
