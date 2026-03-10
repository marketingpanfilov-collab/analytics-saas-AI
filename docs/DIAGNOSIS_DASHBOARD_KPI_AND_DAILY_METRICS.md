# Diagnosis: Dashboard KPI Sub-Metrics & Empty daily_ad_metrics

## 1. Code Path for daily_ad_metrics Write (insights sync)

**File:** `app/api/oauth/meta/insights/sync/route.ts`

### Account-level path (lines 361–385)

1. **Condition:** `canonicalAdAccountId && accRows.length > 0`
2. **Flow:**
   - `canonicalAdAccountId` comes from `integrations_meta.integrations_id` → `ad_accounts` lookup (lines 218–228)
   - `accRows` = Meta API account-level insights (spend, date_start, date_stop)
   - Builds `accMetricsRows` with `campaign_id: null`, `ad_account_id: canonicalAdAccountId`
   - Calls `admin.from("daily_ad_metrics").upsert(accMetricsRows, { onConflict: "ad_account_id,date" })`
3. **No error handling:** Upsert result is ignored; any error would propagate and fail the sync.

### Campaign-level path (lines 416–434)

1. **Condition:** `canonicalAdAccountId && part.length > 0`
2. **Filter:** Only rows where `entityIdToCampaignId.has(r.entity_id)` (campaign exists in `campaigns`)
3. **Flow:** Upserts campaign-level rows with `campaign_id` set.

---

## 2. Why the Canonical Write Block Is Skipped

**Root cause:** `canonicalAdAccountId` is `null`.

**How it’s resolved (lines 218–228):**

```ts
const integrationsId = integration.integrations_id;
if (integrationsId) {
  const { data: adAcc } = await admin
    .from("ad_accounts")
    .select("id")
    .eq("integration_id", integrationsId)
    .eq("platform_account_id", adAccountId)
    .maybeSingle();
  canonicalAdAccountId = adAcc?.id ?? null;
}
```

**If `integrations_meta.integrations_id` is NULL:**

- `integrationsId` is null
- `canonicalAdAccountId` stays null
- Both account-level and campaign-level canonical blocks are skipped

**Likely reasons `integrations_id` is NULL:**

1. Integration created before migration/callback changes
2. Migration backfill only updates rows with `account_id = 'primary'`; if the row has `account_id = 'default'` or `act_xxx`, it is not updated
3. Refresh route updates `account_id` to `act_xxx` when it was null; if the row was created before migrations, it may never have been backfilled

**Verification query for project `8fa1192f-8750-46e7-9514-7024d61cca87`:**

```sql
SELECT id, project_id, account_id, integrations_id, token_source
FROM integrations_meta
WHERE project_id = '8fa1192f-8750-46e7-9514-7024d61cca87';
```

If `integrations_id` is NULL, that explains why `daily_ad_metrics` stays empty.

---

## 3. Dependence on campaigns

- **Account-level:** Does not depend on campaigns. Uses `campaign_id = null`.
- **Campaign-level:** Depends on campaigns. Requires `entityIdToCampaignId` to have `entity_id` → `campaigns.id`. If campaigns sync has not run or campaigns table is empty, campaign-level canonical writes are skipped (filter yields 0 rows).

---

## 4. Account-Level Rows with campaign_id = null

**Schema:** `daily_ad_metrics` allows `campaign_id` NULL.

**Migration:**

```sql
CREATE UNIQUE INDEX idx_daily_ad_metrics_account_date
  ON daily_ad_metrics (ad_account_id, date) WHERE campaign_id IS NULL;
```

**Code:** Account-level rows are built with `campaign_id: null` (line 368). Schema and code are consistent.

---

## 5. Silent Upsert Failure

**Current code:** No error handling around the upsert:

```ts
await admin.from("daily_ad_metrics").upsert(accMetricsRows, {
  onConflict: "ad_account_id,date",
});
```

**Partial unique index:** The table only has partial unique indexes:

- `(ad_account_id, date) WHERE campaign_id IS NULL`
- `(ad_account_id, campaign_id, date) WHERE campaign_id IS NOT NULL`

PostgreSQL `ON CONFLICT` for partial indexes requires the same `WHERE` clause. Supabase/PostgREST typically sends `ON CONFLICT (ad_account_id, date)` without `WHERE`, which can cause:

> "there is no unique or exclusion constraint matching the ON CONFLICT specification"

If this happens, the sync would return 500, not success. Since the sync returns success, the more likely case is that the canonical block is never executed because `canonicalAdAccountId` is null.

---

## 6. Where KPI Card Sub-Metrics Were Removed

**File:** `app/app/page.tsx`

**Current behavior:**

- Line 256: `setSummary({ spend: Number(totals.spend ?? 0) || 0 })` — only `spend` is stored
- Lines 629–664: KPI cards are mostly hardcoded:
  - Spend: uses `summary.spend`
  - Leads: `"—"` and "Скоро"
  - Sales: `"—"` and "Скоро"
  - ROAS: `"—"` and "Скоро"

**API response:** Summary API returns `totals` with `spend`, `clicks`, `leads`, `sales`, `revenue`, `roas`, `cpl`, `cac`.

**Conclusion:** The UI never used these fields. It only stores `spend` and shows placeholders for the rest. There is no evidence of a previous implementation that displayed CPL, CAC, conversion, revenue, or ROAS from the API.

---

## 7. Data Needed for Sub-Metrics

| Metric | Formula | Required fields |
|--------|---------|-----------------|
| CPL | spend / leads | spend, leads |
| CAC | spend / purchases | spend, purchases |
| Lead-to-sale conversion | purchases / leads | purchases, leads |
| Revenue | — | revenue |
| ROAS | revenue / spend | revenue, spend |

**Source:** `meta_insights` (campaign-level) has `leads`, `purchases`, `revenue` from Meta API. Account-level insights use `fields: "spend,date_start,date_stop"` and hardcode leads/purchases/revenue to 0 (lines 318–328).

**Implication:** Account-level `meta_insights` rows have no leads/purchases/revenue. Only campaign-level rows do. So:

- Summary from campaign-level `meta_insights` can provide these metrics
- Summary from account-level only has spend
- `daily_ad_metrics` would have them only if populated from campaign-level insights

---

## 8. Where Values Should Come From

| Scenario | Source | Notes |
|----------|--------|-------|
| Canonical has data | `daily_ad_metrics` | Aggregated by `dashboardCanonical.ts` |
| Legacy only | RPC `dashboard_meta_metrics` or `meta_insights` | Depends on RPC implementation |
| Mixed | Canonical first, legacy fallback | Current design |

**Recommendation:** Keep canonical-first with legacy fallback. When canonical is empty (as now), use legacy. When canonical is populated, use it. Ensure both paths return the same totals shape.

---

## 9. Minimal Safe Fix

### A. Populate daily_ad_metrics

1. **Ensure `integrations_meta.integrations_id` is set** for the project:
   ```sql
   UPDATE integrations_meta im
   SET integrations_id = i.id
   FROM integrations i
   WHERE i.project_id = im.project_id AND i.platform = 'meta'
     AND im.integrations_id IS NULL;
   ```
2. **Re-run insights sync** so the canonical write block runs.
3. **Add error handling** around the daily_ad_metrics upsert and surface errors instead of failing silently.

### B. Fix upsert for partial unique index (if needed)

If upsert fails due to the partial index, either:

- Add a non-partial unique constraint, or
- Use raw SQL with `ON CONFLICT (ad_account_id, date) WHERE (campaign_id IS NULL)`.

### C. Restore KPI sub-metrics in the UI

1. **Store full totals** in state, e.g. `setSummary(totals)` instead of only `spend`.
2. **Update KPI cards** to use:
   - Spend: CPL, CAC (when leads/purchases > 0)
   - Leads: lead-to-sale conversion (when leads > 0)
   - Sales: revenue
   - ROAS: revenue/spend (when spend > 0)
3. **Fallback:** When a metric is undefined or divisor is 0, show `"—"` instead of a number.

---

## 10. Files Involved

| File | Role |
|------|------|
| `app/api/oauth/meta/insights/sync/route.ts` | Canonical write to `daily_ad_metrics`; `canonicalAdAccountId` resolution |
| `app/api/dashboard/summary/route.ts` | Returns totals (cpl, cac, revenue, roas, etc.) |
| `app/app/page.tsx` | KPI cards; only uses `summary.spend`; hardcoded placeholders |
| `app/lib/dashboardCanonical.ts` | Canonical aggregation from `daily_ad_metrics` |
| `supabase/migrations/20250307000005_multi_tenant_daily_ad_metrics.sql` | `daily_ad_metrics` schema and partial unique indexes |

---

## Summary

1. **daily_ad_metrics empty:** `integrations_meta.integrations_id` is likely NULL for this project, so `canonicalAdAccountId` is null and the canonical write block is skipped.
2. **KPI sub-metrics missing:** The UI only stores `spend` and shows placeholders; it never used the API’s `cpl`, `cac`, `revenue`, `roas`, etc.
3. **Fix order:** (1) Backfill `integrations_id` where missing, (2) re-run insights sync, (3) update the UI to use full totals and show sub-metrics with `"—"` when data is unavailable.
