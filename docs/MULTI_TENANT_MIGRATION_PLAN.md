# Multi-Tenant Data Layer — Migration Plan & Adaptation Guide

## Hierarchy

```
organization
    └── organization_members (user_id → auth.users)
    └── projects (organization_id)
            └── integrations (project_id, platform)
                    ├── integrations_meta (integrations_id) — Meta tokens
                    └── ad_accounts (integration_id, platform, platform_account_id)
                            └── campaigns (ad_accounts_id)
                                    └── daily_ad_metrics (ad_account_id, campaign_id, date)
```

---

## SQL Migrations (Order)

Run in Supabase SQL Editor or via `supabase db push`:

| # | File | Purpose |
|---|------|---------|
| 1 | `20250307000001_multi_tenant_organizations.sql` | Create `organizations`, `organization_members`; add `organization_id` to `projects`; backfill default org |
| 2 | `20250307000002_multi_tenant_integrations.sql` | Create `integrations`; add `integrations_id` to `integrations_meta`; backfill |
| 3 | `20250307000003_multi_tenant_ad_accounts.sql` | Create `ad_accounts`; backfill from `meta_ad_accounts` |
| 4 | `20250307000004_multi_tenant_campaigns.sql` | Add `ad_accounts_id` to `campaigns`; backfill |
| 5 | `20250307000005_multi_tenant_daily_ad_metrics.sql` | Create `daily_ad_metrics`; backfill from `meta_insights` |

---

## Backward Compatibility

- **Existing tables** (`integrations_meta`, `meta_ad_accounts`, `meta_insights`, `campaigns`) remain unchanged in structure except for additive columns.
- **Existing routes** continue to read/write legacy tables; no breaking changes.
- **Canonical tables** are additive; backfills populate them from legacy data.

---

## How Meta OAuth Routes Should Be Adapted

### 1. `app/api/oauth/meta/callback/route.ts`

**Current:** Creates `integrations_meta` and `meta_ad_accounts` only.

**Adaptation:**

1. **Before** upserting `integrations_meta`, ensure a canonical `integrations` row exists:
   ```ts
   // Upsert integrations (canonical)
   const { data: int } = await admin.from("integrations").upsert(
     { project_id: projectId, platform: "meta" },
     { onConflict: "project_id,platform" }
   ).select("id").single();
   const integrationsId = int?.id;
   ```

2. **When** upserting `integrations_meta`, set `integrations_id`:
   ```ts
   await admin.from("integrations_meta").upsert({
     project_id: projectId,
     account_id: "primary",
     integrations_id: integrationsId,  // NEW
     access_token, expires_at, token_source,
   }, { onConflict: "project_id,account_id" });
   ```

3. **After** upserting `meta_ad_accounts`, also upsert `ad_accounts`:
   ```ts
   const adAccountRows = adAccounts.map((a) => ({
     integration_id: integrationsId,
     platform: "meta",
     platform_account_id: a.id,
     name: a.name ?? null,
     currency: a.currency ?? null,
     account_status: a.account_status ?? null,
     is_enabled: true,
   }));
   await admin.from("ad_accounts").upsert(adAccountRows, {
     onConflict: "integration_id,platform_account_id",
   });
   ```

### 2. `app/api/oauth/meta/connections/save/route.ts`

**Current:** Updates `meta_ad_accounts.is_enabled` and `integration_id`.

**Adaptation:** When toggling `is_enabled`, sync `ad_accounts`:
```ts
// After updating meta_ad_accounts, sync ad_accounts
const { data: im } = await admin.from("integrations_meta")
  .select("integrations_id").eq("id", integrationId).single();
if (im?.integrations_id) {
  await admin.from("ad_accounts")
    .update({ is_enabled: false })
    .eq("integration_id", im.integrations_id);
  if (adAccountIds.length) {
    await admin.from("ad_accounts")
      .update({ is_enabled: true })
      .eq("integration_id", im.integrations_id)
      .in("platform_account_id", adAccountIds);
  }
}
```

### 3. `app/api/oauth/meta/accounts/route.ts` & `connections/list/route.ts`

**Current:** Read from `meta_ad_accounts` only.

**Adaptation (optional):** Add fallback to `ad_accounts` when `meta_ad_accounts` is empty but `integrations` exists. Or keep as-is; both tables stay in sync after callback/save changes.

---

## How Dashboard Routes Should Be Adapted

### 1. `app/api/dashboard/metrics/route.ts`

**Current:** Reads from `dashboard_meta_metrics` (table/view).

**Adaptation:**

- **Option A (minimal):** Leave as-is. Ensure `dashboard_meta_metrics` view/RPC reads from `meta_insights` (unchanged).
- **Option B (canonical):** Create or update `dashboard_meta_metrics` to aggregate from `daily_ad_metrics` filtered by `project_id` (via `ad_accounts` → `integrations` → `projects`). Example view:
  ```sql
  CREATE OR REPLACE VIEW dashboard_meta_metrics AS
  SELECT
    p.id AS project_id,
    dam.date AS day,
    SUM(dam.spend) AS spend,
    SUM(dam.clicks) AS clicks,
    SUM(dam.purchases) AS purchases,
    SUM(dam.revenue) AS revenue
  FROM daily_ad_metrics dam
  JOIN ad_accounts aa ON aa.id = dam.ad_account_id
  JOIN integrations i ON i.id = aa.integration_id
  JOIN projects p ON p.id = i.project_id
  WHERE i.platform = 'meta'
  GROUP BY p.id, dam.date;
  ```

### 2. `app/api/dashboard/timeseries/route.ts`

**Current:** Calls RPC `dashboard_meta_timeseries(p_project_id, p_start, p_end)`.

**Adaptation:**

- **Option A (minimal):** Keep RPC reading from `meta_insights`; no code change.
- **Option B (canonical):** Update the RPC to read from `daily_ad_metrics` joined through `ad_accounts` → `integrations` → `projects`, filtered by `project_id` and date range.

### 3. `app/api/dashboard/summary/route.ts`

**Current:** Calls RPC `dashboard_meta_metrics` (returns JSONB).

**Adaptation:** Same as above — either keep RPC on `meta_insights` or switch it to aggregate from `daily_ad_metrics`.

---

## Dual-Write Strategy (Recommended)

To keep legacy and canonical in sync during transition:

1. **OAuth callback:** Write to both `integrations_meta` + `meta_ad_accounts` and `integrations` + `ad_accounts`.
2. **Connections save:** Update both `meta_ad_accounts.is_enabled` and `ad_accounts.is_enabled`.
3. **Insights sync:** After upserting `meta_insights`, also upsert `daily_ad_metrics` (or run a periodic backfill job).
4. **Campaigns sync:** After upserting `campaigns`, set `ad_accounts_id` from `ad_accounts` and ensure `daily_ad_metrics` is populated for new campaign-level rows.

---

## Routes That Need No Changes (For Now)

- `app/api/oauth/meta/start/route.ts`
- `app/api/oauth/meta/integration/validate/route.ts`
- `app/api/oauth/meta/integration/status/route.ts`
- `app/api/oauth/meta/integration/current/route.ts`
- `app/api/oauth/meta/campaigns/route.ts` (reads token only)
- `app/api/oauth/meta/campaigns/sync/route.ts` (can add `ad_accounts_id` backfill after upsert)
- `app/api/oauth/meta/insights/sync/route.ts` (can add dual-write to `daily_ad_metrics`)
- `app/api/oauth/meta/connections/upsert/route.ts`
- `app/api/health/route.ts`
- `app/lib/metaIntegration.ts`

---

## Summary

| Area | Action |
|------|--------|
| **Migrations** | Run 5 SQL files in order; all additive, backfills included |
| **OAuth callback** | Create `integrations` + `ad_accounts`; set `integrations_meta.integrations_id` |
| **Connections save** | Sync `ad_accounts.is_enabled` with `meta_ad_accounts.is_enabled` |
| **Insights sync** | Optionally dual-write to `daily_ad_metrics` |
| **Campaigns sync** | Set `campaigns.ad_accounts_id` after upsert |
| **Dashboard** | Keep RPCs/views on legacy tables, or switch to `daily_ad_metrics` |
