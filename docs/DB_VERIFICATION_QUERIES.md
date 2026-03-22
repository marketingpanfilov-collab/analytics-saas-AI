# DB verification queries

Run these after migrations to verify no duplicates and consistent totals.

## 1. Duplicate campaigns by normalized external_campaign_id

```sql
SELECT
  ad_accounts_id,
  platform,
  trim(coalesce(external_campaign_id, '')) AS ext_norm,
  count(*) AS cnt,
  array_agg(id ORDER BY created_at ASC NULLS LAST, id ASC) AS campaign_ids
FROM public.campaigns
WHERE platform = 'google'
  AND ad_accounts_id IS NOT NULL
  AND trim(coalesce(external_campaign_id, '')) <> ''
GROUP BY ad_accounts_id, platform, trim(coalesce(external_campaign_id, ''))
HAVING count(*) > 1;
```

**Expected after fix:** 0 rows.

---

## 2. Campaigns with ad_accounts_id IS NULL

```sql
SELECT count(*) AS campaigns_null_ad_accounts_id
FROM public.campaigns
WHERE ad_accounts_id IS NULL;

SELECT id, project_id, platform, external_campaign_id, name
FROM public.campaigns
WHERE ad_accounts_id IS NULL
LIMIT 50;
```

---

## 3. Orphan metrics (campaign_id or ad_account_id not in parent table)

Account-level rows (campaign_id IS NULL) are not “orphan campaign” rows; they are valid. Only campaign-level rows must reference an existing campaign. All rows must reference an existing ad_account.

```sql
-- Orphan campaign-level: rows with campaign_id not in campaigns (only campaign-level rows are checked)
SELECT count(*) AS orphan_campaign_level
FROM public.daily_ad_metrics m
WHERE m.campaign_id IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM public.campaigns c WHERE c.id = m.campaign_id);

-- Orphan ad_account: any row (campaign- or account-level) with ad_account_id not in ad_accounts
SELECT count(*) AS orphan_ad_account
FROM public.daily_ad_metrics m
WHERE NOT EXISTS (SELECT 1 FROM public.ad_accounts a WHERE a.id = m.ad_account_id);
```

**Expected:** 0 for both.

---

## 4. Duplicate daily_ad_metrics (campaign-level)

```sql
SELECT ad_account_id, campaign_id, date, count(*) AS cnt
FROM public.daily_ad_metrics
WHERE campaign_id IS NOT NULL
GROUP BY ad_account_id, campaign_id, date
HAVING count(*) > 1;
```

**Expected after fix:** 0 rows.

---

## 5. Duplicate daily_ad_metrics (account-level)

```sql
SELECT ad_account_id, date, count(*) AS cnt
FROM public.daily_ad_metrics
WHERE campaign_id IS NULL
GROUP BY ad_account_id, date
HAVING count(*) > 1;
```

**Expected after fix:** 0 rows.

---

## 6. Spend totals by ad_account_id and date range

```sql
SELECT
  ad_account_id,
  count(*) AS row_count,
  count(distinct date) AS distinct_dates,
  sum(spend) AS total_spend,
  min(date) AS min_date,
  max(date) AS max_date
FROM public.daily_ad_metrics
WHERE date >= '2026-02-01' AND date <= '2026-03-16'
GROUP BY ad_account_id;
```

---

## 7. Campaign-level Google spend vs dashboard scope

```sql
SELECT
  sum(spend) AS campaign_level_spend,
  count(*) AS campaign_level_rows,
  count(distinct date) AS distinct_dates
FROM public.daily_ad_metrics d
WHERE d.platform = 'google'
  AND d.campaign_id IS NOT NULL
  AND d.date >= '2026-02-01' AND d.date <= '2026-03-16';
```

---

## 8. Single day check (e.g. 2026-03-01 or 2026-03-16)

```sql
SELECT
  d.ad_account_id,
  d.campaign_id,
  d.date,
  d.platform,
  d.spend,
  d.impressions,
  d.clicks
FROM public.daily_ad_metrics d
WHERE d.date = '2026-03-16'
ORDER BY d.ad_account_id, d.campaign_id NULLS FIRST;
```

---

## 9. Count campaigns with ad_accounts_id IS NULL (for NOT NULL decision)

```sql
SELECT count(*) FROM public.campaigns WHERE ad_accounts_id IS NULL;
```

If this is 0 after cleanup, consider: `ALTER TABLE public.campaigns ALTER COLUMN ad_accounts_id SET NOT NULL;` (only after backup and confirmation).

---

## 10. Summary: what should be 0 after fixes

| Check | Query | Expected | If not 0 |
|-------|--------|----------|----------|
| Duplicate Google campaigns | §1 | 0 rows | Re-run 20250605000000 or fix trim/UNIQUE. |
| Orphan campaign-level metrics | §3 (orphan_campaign_level) | 0 | Remap or delete invalid campaign_id refs. |
| Orphan ad_account metrics | §3 (orphan_ad_account) | 0 | Fix ad_accounts or remap metrics. |
| Duplicate campaign-level metrics | §4 | 0 rows | Re-run 20250606000000 dedupe. |
| Duplicate account-level metrics | §5 | 0 rows | Re-run 20250606000000 dedupe. |

| Check | Query | May be > 0 | Meaning |
|-------|--------|------------|---------|
| Campaigns with ad_accounts_id IS NULL | §2, §9 | Yes | Legacy/unmapped; see LEGACY_CAMPAIGNS_CLEANUP_STRATEGY.md. Do not set NOT NULL until 0. |
