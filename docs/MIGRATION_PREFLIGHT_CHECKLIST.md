# Migration Preflight Checklist

Run these verification queries **before** each migration. If any check fails, fix the issue before proceeding.

---

## Before Migration 001 (`20250307000001_multi_tenant_organizations.sql`)

### Check 1.1: `projects` table exists

```sql
SELECT EXISTS (
  SELECT 1 FROM information_schema.tables
  WHERE table_schema = 'public' AND table_name = 'projects'
) AS projects_exists;
```

**Expected:** `projects_exists = true`

**If false:** Migration 001 will fail at `ALTER TABLE public.projects`. Create the `projects` table first, or skip migration 001 if projects are managed elsewhere.

---

### Check 1.2: `projects` has `id` column (uuid)

```sql
SELECT column_name, data_type
FROM information_schema.columns
WHERE table_schema = 'public' AND table_name = 'projects' AND column_name = 'id';
```

**Expected:** One row: `column_name = id`, `data_type = uuid`

**If no rows:** `projects` exists but has no `id` column. Migration adds `organization_id` referencing `organizations`; the UPDATE backfill uses `projects.id` implicitly. Add an `id` column (uuid, PK) to `projects` before proceeding.

---

### Check 1.3: `organization_id` not already present (optional)

```sql
SELECT column_name
FROM information_schema.columns
WHERE table_schema = 'public' AND table_name = 'projects' AND column_name = 'organization_id';
```

**Expected:** No rows (column does not exist yet)

**If rows exist:** Migration uses `ADD COLUMN IF NOT EXISTS`, so it will not fail. The backfill UPDATE will still run. No fix needed; you may have run 001 before.

---

## Before Migration 002 (`20250307000002_multi_tenant_integrations.sql`)

### Check 2.1: `integrations_meta` table exists

```sql
SELECT EXISTS (
  SELECT 1 FROM information_schema.tables
  WHERE table_schema = 'public' AND table_name = 'integrations_meta'
) AS integrations_meta_exists;
```

**Expected:** `integrations_meta_exists = true`

**If false:** Migration 002 will fail at `ALTER TABLE public.integrations_meta`. Create `integrations_meta` or ensure the correct table name is used.

---

### Check 2.2: `integrations_meta` has required columns

```sql
SELECT column_name
FROM information_schema.columns
WHERE table_schema = 'public' AND table_name = 'integrations_meta'
ORDER BY ordinal_position;
```

**Expected:** At least `id`, `project_id`, `account_id`

**If missing:** The backfill uses `project_id` and `account_id`. Add the missing columns or adjust the migration. Without `account_id`, the `WHERE im.account_id = 'primary'` filter cannot run.

---

### Check 2.3: No orphaned `project_id` in `integrations_meta`

```sql
SELECT im.id, im.project_id
FROM public.integrations_meta im
LEFT JOIN public.projects p ON p.id = im.project_id
WHERE p.id IS NULL;
```

**Expected:** 0 rows

**If rows returned:** Those `integrations_meta` rows have `project_id` pointing to non-existent projects. The INSERT into `integrations` will violate the FK `project_id REFERENCES projects(id)`. Fix by either: (a) deleting orphaned `integrations_meta` rows, (b) updating `project_id` to a valid project, or (c) creating the missing projects.

---

### Check 2.4: At least one `integrations_meta` row with `account_id = 'primary'` (if expecting backfill)

```sql
SELECT COUNT(*) AS primary_count
FROM public.integrations_meta
WHERE account_id = 'primary';
```

**Expected:** ≥ 0 (0 is valid if you have no Meta integrations yet)

**If 0 and you expect Meta data:** The backfill will create 0 `integrations` rows and set 0 `integrations_id` values. This is not an error, but downstream migrations (003, 004, 005) may backfill nothing. Ensure Meta OAuth has been completed at least once if you expect data.

---

## Before Migration 003 (`20250307000003_multi_tenant_ad_accounts.sql`)

### Check 3.1: `meta_ad_accounts` table exists

```sql
SELECT EXISTS (
  SELECT 1 FROM information_schema.tables
  WHERE table_schema = 'public' AND table_name = 'meta_ad_accounts'
) AS meta_ad_accounts_exists;
```

**Expected:** `meta_ad_accounts_exists = true`

**If false:** Migration 003 will fail at the INSERT. Create `meta_ad_accounts` or fix the table name.

---

### Check 3.2: `meta_ad_accounts` has required columns

```sql
SELECT column_name
FROM information_schema.columns
WHERE table_schema = 'public' AND table_name = 'meta_ad_accounts'
ORDER BY ordinal_position;
```

**Expected:** At least `project_id`, `integration_id`, `ad_account_id`. Ideally also `name`, `currency`, `account_status`, `is_enabled`.

**If missing:** The JOIN and SELECT will fail. Add the missing columns. `integration_id` must reference `integrations_meta.id`.

---

### Check 3.3: `integrations_meta.integrations_id` populated (after 002)

```sql
SELECT COUNT(*) AS with_integrations_id
FROM public.integrations_meta
WHERE integrations_id IS NOT NULL;
```

**Expected:** ≥ 0. If you have `integrations_meta` with `account_id = 'primary'`, this should be > 0 after migration 002.

**If 0 and meta_ad_accounts has rows:** Migration 003 backfill will insert 0 rows because of `WHERE im.integrations_id IS NOT NULL`. Re-run migration 002 or fix the 002 backfill so `integrations_id` is set.

---

### Check 3.4: `meta_ad_accounts.integration_id` matches `integrations_meta.id`

```sql
SELECT ma.id, ma.integration_id
FROM public.meta_ad_accounts ma
LEFT JOIN public.integrations_meta im ON im.id = ma.integration_id
WHERE im.id IS NULL;
```

**Expected:** 0 rows

**If rows returned:** Those `meta_ad_accounts` rows have `integration_id` not in `integrations_meta`. They will be excluded from the backfill. Fix by updating `integration_id` to a valid `integrations_meta.id`, or remove orphaned rows.

---

## Before Migration 004 (`20250307000004_multi_tenant_campaigns.sql`)

### Check 4.1: `campaigns` table exists

```sql
SELECT EXISTS (
  SELECT 1 FROM information_schema.tables
  WHERE table_schema = 'public' AND table_name = 'campaigns'
) AS campaigns_exists;
```

**Expected:** `campaigns_exists = true`

**If false:** Migration 004 will fail at `ALTER TABLE public.campaigns`. Create the `campaigns` table first.

---

### Check 4.2: `campaigns` has required columns

```sql
SELECT column_name
FROM information_schema.columns
WHERE table_schema = 'public' AND table_name = 'campaigns'
ORDER BY ordinal_position;
```

**Expected:** At least `project_id`, `ad_account_id`, `meta_campaign_id`

**If missing:** The backfill JOIN uses these columns. Add them before proceeding.

---

### Check 4.3: `ad_accounts` has rows (after 003)

```sql
SELECT COUNT(*) AS ad_accounts_count FROM public.ad_accounts;
```

**Expected:** ≥ 0

**If 0 and campaigns has rows:** The backfill UPDATE will set `ad_accounts_id` for 0 campaigns. Campaigns will keep `ad_accounts_id = NULL`. Not an error; fix by ensuring migration 003 backfill succeeded.

---

### Check 4.4: `ad_accounts_id` not already present (optional)

```sql
SELECT column_name
FROM information_schema.columns
WHERE table_schema = 'public' AND table_name = 'campaigns' AND column_name = 'ad_accounts_id';
```

**Expected:** No rows (column does not exist yet)

**If rows exist:** Migration uses `ADD COLUMN IF NOT EXISTS`, so it will not fail. No fix needed.

---

## Before Migration 005 (`20250307000005_multi_tenant_daily_ad_metrics.sql`)

### Check 5.1: `meta_insights` table exists

```sql
SELECT EXISTS (
  SELECT 1 FROM information_schema.tables
  WHERE table_schema = 'public' AND table_name = 'meta_insights'
) AS meta_insights_exists;
```

**Expected:** `meta_insights_exists = true`

**If false:** Migration 005 will fail at the INSERT. Create `meta_insights` or ensure the table exists. If you do not use insights yet, you may skip migration 005 or create an empty `meta_insights` with the expected schema.

---

### Check 5.2: `meta_insights` has required columns

```sql
SELECT column_name, data_type
FROM information_schema.columns
WHERE table_schema = 'public' AND table_name = 'meta_insights'
ORDER BY ordinal_position;
```

**Expected:** At least: `project_id`, `ad_account_id`, `level`, `entity_id`, `date_start`, `spend`, `impressions`, `clicks`, `reach`, `cpm`, `cpc`, `ctr`, `leads`, `purchases`, `revenue`, `roas`

**If missing:** The INSERT will fail. Add the missing columns or adjust the migration. `date_start` must be castable to `date` (e.g. `date`, `timestamp`, `timestamptz`, or `text` in `YYYY-MM-DD` format).

---

### Check 5.3: `date_start` is castable to date

```sql
SELECT date_start, date_start::date AS date_cast
FROM public.meta_insights
WHERE date_start IS NOT NULL
LIMIT 3;
```

**Expected:** Query runs without error; `date_cast` is a valid date.

**If error:** `date_start` type or format cannot be cast to `date`. Change column type or data before proceeding.

---

### Check 5.4: `entity_id` and `meta_campaign_id` types compatible (for campaign-level backfill)

```sql
SELECT
  (SELECT pg_typeof(entity_id)::text FROM public.meta_insights WHERE level = 'campaign' AND entity_id IS NOT NULL LIMIT 1) AS entity_id_type,
  (SELECT pg_typeof(meta_campaign_id)::text FROM public.campaigns LIMIT 1) AS meta_campaign_id_type;
```

**Expected:** Both types should be comparable (e.g. both `text`, or both `bigint`). Common: `text` and `text`.

**If incompatible (e.g. `bigint` vs `text`):** The campaign-level JOIN `c.meta_campaign_id = mi.entity_id` may produce 0 rows. Cast one column to match the other in the migration, or normalize types in the tables.

---

### Check 5.5: Sample join for campaign-level backfill (dry run)

```sql
SELECT COUNT(*) AS match_count
FROM public.meta_insights mi
JOIN public.campaigns c ON c.project_id = mi.project_id
  AND c.ad_account_id = mi.ad_account_id
  AND c.meta_campaign_id::text = mi.entity_id::text
JOIN public.meta_ad_accounts ma ON ma.project_id = mi.project_id AND ma.ad_account_id = mi.ad_account_id
JOIN public.integrations_meta im ON im.id = ma.integration_id AND im.project_id = ma.project_id
JOIN public.ad_accounts aa ON aa.integration_id = im.integrations_id AND aa.platform_account_id = ma.ad_account_id
WHERE mi.level = 'campaign'
  AND mi.entity_id IS NOT NULL
  AND mi.date_start IS NOT NULL
  AND im.integrations_id IS NOT NULL;
```

**Expected:** Query runs; `match_count` ≥ 0. If you have campaign-level insights, expect > 0.

**If error:** Fix schema or join logic. Note: The actual migration uses `c.meta_campaign_id = mi.entity_id` without `::text`; if types differ, the migration may need adjustment. This check uses `::text` to test compatibility.

---

## Preflight Execution Sequence

1. Run all checks for **Migration 001**. Fix any failures. Proceed only when all pass.
2. Apply Migration 001.
3. Run all checks for **Migration 002**. Fix any failures.
4. Apply Migration 002.
5. Run all checks for **Migration 003**. Fix any failures.
6. Apply Migration 003.
7. Run all checks for **Migration 004**. Fix any failures.
8. Apply Migration 004.
9. Run all checks for **Migration 005**. Fix any failures.
10. Apply Migration 005.
