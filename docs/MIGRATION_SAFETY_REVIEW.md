# Migration Safety Review

Review of `supabase/migrations/20250307*` for production-like deployment.

---

## 1. Additive & Safe for Production

| Migration | Additive? | Destructive? | Reversible? |
|-----------|-----------|---------------|--------------|
| 001 organizations | ✅ Yes | ❌ No | ⚠️ Partial (drop new tables/columns) |
| 002 integrations | ✅ Yes | ❌ No | ⚠️ Partial |
| 003 ad_accounts | ✅ Yes | ❌ No | ⚠️ Partial |
| 004 campaigns | ✅ Yes | ❌ No | ⚠️ Partial |
| 005 daily_ad_metrics | ✅ Yes | ❌ No | ⚠️ Partial |

**Summary:** All migrations are additive. No `DROP`, `TRUNCATE`, or `DELETE` of existing data. New columns are nullable. Backfills use `WHERE NOT EXISTS` / `WHERE ... IS NULL` for idempotency.

---

## 2. Foreign Key, Nullability & Backfill Risks

### Migration 001: Organizations

| Risk | Severity | Description |
|------|----------|-------------|
| **projects table missing** | High | `ALTER TABLE public.projects` fails if `projects` does not exist |
| **organization_members → auth.users** | Medium | FK to `auth.users(id)`. If RLS or app inserts `user_id` not in `auth.users`, insert fails. Migration does not insert org members. |
| **Default org INSERT** | Low | `WHERE NOT EXISTS ... LIMIT 1` is idempotent. Re-run safe. |
| **Projects UPDATE with no default org** | Low | If INSERT skipped (e.g. slug exists) and default org was deleted, subquery returns NULL → `organization_id = NULL`. No error. |

### Migration 002: Integrations

| Risk | Severity | Description |
|------|----------|-------------|
| **integrations_meta table missing** | High | `ALTER TABLE integrations_meta` fails if table does not exist |
| **integrations_meta.project_id orphaned** | High | INSERT into `integrations` has FK `project_id REFERENCES projects(id)`. If `integrations_meta` has `project_id` pointing to deleted/non-existent project → **FK violation** |
| **account_id ≠ 'primary'** | Low | Rows with `account_id != 'primary'` are skipped. Intentional; only `primary` is canonical. |
| **integrations_meta missing account_id column** | Medium | Query fails if schema differs from expected |

### Migration 003: Ad Accounts

| Risk | Severity | Description |
|------|----------|-------------|
| **meta_ad_accounts table missing** | High | INSERT fails |
| **integrations_id NULL for all** | Medium | If migration 002 backfill failed or no `account_id='primary'` rows, `integrations_id` is NULL for all. JOIN `WHERE im.integrations_id IS NOT NULL` excludes all → 0 rows inserted. No error, but no ad_accounts. |
| **meta_ad_accounts.integration_id orphaned** | Medium | If `ma.integration_id` doesn't match any `integrations_meta.id`, JOIN excludes row. No FK error. |
| **meta_ad_accounts.integration_id ↔ project_id mismatch** | Low | JOIN requires `im.project_id = ma.project_id`. Mismatched pairs excluded. |

### Migration 004: Campaigns

| Risk | Severity | Description |
|------|----------|-------------|
| **campaigns table missing** | High | `ALTER TABLE campaigns` fails |
| **ad_accounts empty** | Medium | Backfill UPDATE affects 0 rows if no ad_accounts. `campaigns.ad_accounts_id` stays NULL. No error. |
| **Campaigns with orphaned ad_account_id** | Low | Campaigns whose `ad_account_id` (platform id) no longer exists in `meta_ad_accounts` are unchanged. `ad_accounts_id` stays NULL. |

### Migration 005: Daily Ad Metrics

| Risk | Severity | Description |
|------|----------|-------------|
| **meta_insights table missing** | High | INSERT fails |
| **meta_insights schema mismatch** | High | Assumes columns: `project_id`, `ad_account_id`, `level`, `entity_id`, `date_start`, `spend`, `impressions`, `clicks`, `reach`, `cpm`, `cpc`, `ctr`, `leads`, `purchases`, `revenue`, `roas`. Missing or renamed columns → error |
| **date_start type** | Medium | `mi.date_start::date` assumes `date_start` is valid for date cast. If `date_start` is `text` with wrong format or NULL, behavior varies. `WHERE mi.date_start IS NOT NULL` filters NULLs. |
| **entity_id vs meta_campaign_id type** | Medium | Campaign-level JOIN uses `c.meta_campaign_id = mi.entity_id`. If one is `bigint` and one is `text`, join may fail or produce 0 rows. |
| **Campaign-level backfill with no campaigns** | Low | If no matching campaigns, 0 rows. No error. |

---

## 3. Execution Order

Order is correct and enforced by dependencies:

```
001 → 002 → 003 → 004 → 005
 │      │      │      │      │
 │      │      │      │      └─ needs: ad_accounts, campaigns, meta_insights
 │      │      │      └─ needs: ad_accounts, campaigns
 │      │      └─ needs: integrations, integrations_meta, meta_ad_accounts
 │      └─ needs: projects, integrations_meta
 └─ needs: projects
```

---

## 4. Manual Verification Before Each Migration

### Before Migration 001

```sql
-- 1. projects exists
SELECT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'projects');

-- 2. projects has id column (uuid)
SELECT column_name, data_type FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'projects' AND column_name = 'id';

-- 3. (Optional) Count projects for backfill estimate
SELECT COUNT(*) FROM public.projects;
```

### Before Migration 002

```sql
-- 1. integrations_meta exists
SELECT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'integrations_meta');

-- 2. integrations_meta has required columns
SELECT column_name FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'integrations_meta';
-- Expected: project_id, account_id, id (at minimum)

-- 3. No orphaned project_id (all integrations_meta.project_id exist in projects)
SELECT im.project_id FROM public.integrations_meta im
LEFT JOIN public.projects p ON p.id = im.project_id
WHERE p.id IS NULL;
-- Should return 0 rows.

-- 4. Count integrations_meta with account_id='primary'
SELECT COUNT(*) FROM public.integrations_meta WHERE account_id = 'primary';
```

### Before Migration 003

```sql
-- 1. meta_ad_accounts exists
SELECT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'meta_ad_accounts');

-- 2. integrations_meta.integrations_id populated (after 002)
SELECT COUNT(*) FROM public.integrations_meta WHERE integrations_id IS NOT NULL;

-- 3. meta_ad_accounts has required columns
SELECT column_name FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'meta_ad_accounts';
-- Expected: project_id, integration_id, ad_account_id, name, currency, account_status, is_enabled
```

### Before Migration 004

```sql
-- 1. campaigns exists
SELECT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'campaigns');

-- 2. ad_accounts has rows (after 003)
SELECT COUNT(*) FROM public.ad_accounts;

-- 3. campaigns has required columns
SELECT column_name FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'campaigns';
-- Expected: project_id, ad_account_id, meta_campaign_id
```

### Before Migration 005

```sql
-- 1. meta_insights exists
SELECT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'meta_insights');

-- 2. meta_insights has required columns
SELECT column_name, data_type FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'meta_insights'
ORDER BY ordinal_position;
-- Expected: project_id, ad_account_id, level, entity_id, date_start, spend, impressions, clicks, reach, cpm, cpc, ctr, leads, purchases, revenue, roas

-- 3. date_start type (should be date, timestamp, or text)
SELECT data_type FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'meta_insights' AND column_name = 'date_start';

-- 4. Sample entity_id type (for campaign-level join)
SELECT entity_id, pg_typeof(entity_id) FROM public.meta_insights WHERE level = 'campaign' AND entity_id IS NOT NULL LIMIT 1;

-- 5. campaigns.meta_campaign_id type
SELECT meta_campaign_id, pg_typeof(meta_campaign_id) FROM public.campaigns LIMIT 1;
```

---

## 5. Recommended Execution Checklist

### Pre-requisites

- [ ] Backup database (Supabase: Project Settings → Database → Backups, or `pg_dump`)
- [ ] Run migrations in a staging environment first
- [ ] Confirm no long-running transactions or heavy load during migration

### Per-migration

For each migration:

1. [ ] Run the manual verification queries for that migration
2. [ ] Fix any issues (e.g. orphaned `project_id`, missing tables)
3. [ ] Apply migration in a transaction (Supabase SQL Editor: wrap in `BEGIN;` ... `COMMIT;` or run single migration)
4. [ ] Verify post-migration state (see below)
5. [ ] If failure: `ROLLBACK` or restore from backup

### Post-migration verification

**After 001:**

```sql
SELECT COUNT(*) FROM public.organizations WHERE slug = 'default';
SELECT COUNT(*) FROM public.projects WHERE organization_id IS NOT NULL;
```

**After 002:**

```sql
SELECT COUNT(*) FROM public.integrations;
SELECT COUNT(*) FROM public.integrations_meta WHERE integrations_id IS NOT NULL;
```

**After 003:**

```sql
SELECT COUNT(*) FROM public.ad_accounts;
-- Compare with meta_ad_accounts
SELECT COUNT(*) FROM public.meta_ad_accounts ma
JOIN public.integrations_meta im ON im.id = ma.integration_id AND im.integrations_id IS NOT NULL;
```

**After 004:**

```sql
SELECT COUNT(*) FROM public.campaigns WHERE ad_accounts_id IS NOT NULL;
SELECT COUNT(*) FROM public.campaigns WHERE ad_accounts_id IS NULL;
```

**After 005:**

```sql
SELECT COUNT(*) FROM public.daily_ad_metrics;
-- Compare with meta_insights
SELECT COUNT(*) FROM public.meta_insights WHERE level = 'account';
SELECT COUNT(*) FROM public.meta_insights WHERE level = 'campaign';
```

### Rollback (if needed)

If you must rollback before application code is updated:

```sql
-- Reverse order (005 → 001)
DROP TABLE IF EXISTS public.daily_ad_metrics CASCADE;
ALTER TABLE public.campaigns DROP COLUMN IF EXISTS ad_accounts_id;
DROP TABLE IF EXISTS public.ad_accounts CASCADE;
ALTER TABLE public.integrations_meta DROP COLUMN IF EXISTS integrations_id;
DROP TABLE IF EXISTS public.integrations CASCADE;
ALTER TABLE public.projects DROP COLUMN IF EXISTS organization_id;
DROP TABLE IF EXISTS public.organization_members CASCADE;
DROP TABLE IF EXISTS public.organizations CASCADE;
```

---

## 6. Summary

| Aspect | Assessment |
|--------|------------|
| **Additive** | ✅ All migrations are additive |
| **Idempotent** | ✅ Backfills use NOT EXISTS / IS NULL guards |
| **Order** | ✅ Correct dependency order |
| **FK risks** | ⚠️ Migration 002: orphaned `integrations_meta.project_id` can cause FK violation |
| **Table existence** | ⚠️ Migrations assume `projects`, `integrations_meta`, `meta_ad_accounts`, `campaigns`, `meta_insights` exist |
| **Schema assumptions** | ⚠️ Migration 005 assumes specific `meta_insights` columns and types |

**Recommendation:** Run the manual verification queries before each migration, especially for 002 (orphaned `project_id`) and 005 (`meta_insights` schema). Apply in a transaction if possible, and keep a backup.
