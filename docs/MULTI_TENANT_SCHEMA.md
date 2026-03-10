# Multi-Tenant Data Model — Schema Proposal

## Running Migrations

If using Supabase CLI:

```bash
supabase db push
```

Or apply migrations manually in the Supabase SQL Editor in order:
1. `supabase/migrations/20250307000001_multi_tenant_organizations.sql`
2. `supabase/migrations/20250307000002_multi_tenant_integrations.sql`
3. `supabase/migrations/20250307000003_multi_tenant_ad_accounts.sql`
4. `supabase/migrations/20250307000004_multi_tenant_campaigns.sql`
5. `supabase/migrations/20250307000005_multi_tenant_daily_ad_metrics.sql`

---

## Business Model Hierarchy

```
Organization (1) ──► many Projects
Organization (1) ──► many organization_members (user_id)
Project (1) ──► many Integrations (platform connections)
Integration (1) ──► many Ad Accounts
Ad Account (1) ──► many Campaigns
Campaign (1) ──► many daily_ad_metrics (by date)
Ad Account (1) ──► many daily_ad_metrics (account-level, campaign_id = null)
```

---

## Proposed Schema

### 1. `organizations`

| Column       | Type         | Constraints                    | Description                    |
|-------------|--------------|--------------------------------|--------------------------------|
| id          | uuid         | PK, default gen_random_uuid()  | Primary key                    |
| name        | text         | NOT NULL                       | Display name                   |
| slug        | text         | UNIQUE, NOT NULL               | URL-safe identifier            |
| created_at  | timestamptz  | default now()                  |                                |
| updated_at  | timestamptz  | default now()                  |                                |

### 2. `organization_members`

| Column          | Type        | Constraints                    | Description                    |
|-----------------|-------------|--------------------------------|--------------------------------|
| id              | uuid        | PK, default gen_random_uuid()  | Primary key                    |
| organization_id | uuid        | FK → organizations(id), NOT NULL |                                |
| user_id         | uuid        | FK → auth.users(id), NOT NULL  | Supabase Auth user             |
| role            | text        | NOT NULL, default 'member'     | owner \| admin \| member       |
| created_at      | timestamptz | default now()                  |                                |

Unique: (organization_id, user_id)

### 3. `projects` (updated)

| Column          | Type        | Constraints                    | Description                    |
|-----------------|-------------|--------------------------------|--------------------------------|
| id              | uuid        | PK (existing)                  |                                |
| organization_id | uuid        | FK → organizations(id), nullable | **NEW** — backfilled in migration |
| name            | text        | (existing if any)               |                                |
| slug            | text        | (existing if any)               |                                |
| created_at      | timestamptz | (existing)                      |                                |
| updated_at      | timestamptz | (existing)                     |                                |

### 4. `integrations` (canonical, new)

| Column       | Type        | Constraints                    | Description                    |
|--------------|-------------|--------------------------------|--------------------------------|
| id           | uuid        | PK, default gen_random_uuid() | Primary key                    |
| project_id   | uuid        | FK → projects(id), NOT NULL    |                                |
| platform     | text        | NOT NULL                       | 'meta' \| 'google' \| 'tiktok' |
| created_at   | timestamptz | default now()                  |                                |
| updated_at   | timestamptz | default now()                  |                                |

Unique: (project_id, platform) — one integration per platform per project.

### 5. `integrations_meta` (existing, extended for backward compat)

| Column            | Type   | Constraints                    | Description                    |
|-------------------|--------|--------------------------------|--------------------------------|
| id                | uuid   | PK (existing)                  |                                |
| project_id        | uuid   | FK (existing)                  |                                |
| integrations_id   | uuid   | FK → integrations(id), nullable | **NEW** — links to canonical  |
| account_id        | text   | (existing)                     | 'primary' etc.                 |
| access_token      | text   | (existing)                     |                                |
| expires_at        | timestamptz | (existing)                 |                                |
| token_source      | text   | (existing)                     |                                |
| created_at        | timestamptz | (existing)                 |                                |

Unique (existing): (project_id, account_id)

### 6. `ad_accounts` (canonical, new)

| Column             | Type        | Constraints                    | Description                    |
|--------------------|-------------|--------------------------------|--------------------------------|
| id                 | uuid        | PK, default gen_random_uuid()  | Primary key                    |
| integration_id     | uuid        | FK → integrations(id), NOT NULL |                              |
| platform           | text        | NOT NULL                       | 'meta' \| 'google' \| 'tiktok' |
| platform_account_id| text        | NOT NULL                       | e.g. 'act_123' for Meta        |
| name               | text        |                                |                                |
| currency            | text        |                                |                                |
| account_status     | int         |                                |                                |
| is_enabled         | boolean     | default true                   | Selected for sync              |
| created_at         | timestamptz | default now()                  |                                |
| updated_at         | timestamptz | default now()                  |                                |

Unique: (integration_id, platform_account_id)

### 7. `campaigns` (existing, extended)

| Column          | Type        | Constraints                    | Description                    |
|-----------------|-------------|--------------------------------|--------------------------------|
| id              | uuid        | PK (existing)                  |                                |
| project_id      | uuid        | (existing)                     |                                |
| ad_accounts_id  | uuid        | FK → ad_accounts(id), nullable | **NEW** — canonical parent     |
| meta_campaign_id| text        | (existing)                     | Platform campaign id           |
| ad_account_id   | text        | (existing)                     | Platform ad account id         |
| name            | text        | (existing)                     |                                |
| status          | text        | (existing)                     |                                |
| objective       | text        | (existing)                     |                                |

### 8. `daily_ad_metrics` (canonical, new)

| Column        | Type         | Constraints                    | Description                    |
|---------------|--------------|--------------------------------|--------------------------------|
| id            | uuid         | PK                             |                                |
| ad_account_id | uuid         | FK → ad_accounts(id), NOT NULL |                                |
| campaign_id   | uuid         | FK → campaigns(id), nullable   | null = account-level           |
| date          | date         | NOT NULL                       |                                |
| platform      | text         | NOT NULL                       | 'meta' \| 'google' \| 'tiktok' |
| spend         | numeric      | default 0                      |                                |
| impressions   | bigint       | default 0                      |                                |
| clicks        | bigint       | default 0                      |                                |
| leads         | bigint       | default 0                      |                                |
| purchases     | bigint       | default 0                      |                                |
| revenue       | numeric      | default 0                      |                                |
| roas          | numeric      | default 0                      |                                |
| ...           |              |                                |                                |

Unique: (ad_account_id, date) when campaign_id IS NULL; (ad_account_id, campaign_id, date) when campaign_id IS NOT NULL.

### 9. `meta_ad_accounts` (existing, kept for backward compat)

No schema change. Continues to store Meta ad accounts. Links via:
- `integration_id` → `integrations_meta.id`
- Canonical `ad_accounts` can be populated from `meta_ad_accounts` joined through `integrations_meta.integrations_id` → `integrations.id`

---

## Entity Relationship Diagram

```
organizations
    │
    ├── organization_members (user_id → auth.users)
    │
    └── projects (organization_id)
            │
            └── integrations (project_id, platform)
                    │
                    ├── integrations_meta (integrations_id) — Meta tokens
                    │
                    └── ad_accounts (integration_id, platform, platform_account_id)
                            │
                            ├── meta_ad_accounts (project_id, integration_id) — legacy Meta
                            ├── campaigns (ad_accounts_id) — canonical link
                            └── daily_ad_metrics (ad_account_id, campaign_id, date)
```

---

## Migration Plan

### Phase 1: Organizations and project binding

1. Create `organizations` table.
2. Create `organization_members` table.
3. Add `organization_id` to `projects` (nullable).
4. Create default organization and backfill: one org "Default Organization", assign all existing projects to it.
5. Add RLS policies (optional, can be separate migration).

### Phase 2: Canonical integrations

6. Create `integrations` table.
7. Add `integrations_id` to `integrations_meta` (nullable).
8. Backfill: for each `integrations_meta` row, create `integrations` row (project_id, platform='meta'), set `integrations_meta.integrations_id`.

### Phase 3: Canonical ad_accounts

9. Create `ad_accounts` table.
10. Backfill: for each `meta_ad_accounts` row, resolve `integrations.id` via `integrations_meta.integrations_id`, insert into `ad_accounts`.

### Phase 4: Application updates (later)

11. Update OAuth callback to create `integrations` and `ad_accounts` when creating new Meta connections.
12. Gradually migrate routes to use canonical tables; keep legacy tables in sync until full migration.

---

## Backward Compatibility

- **Existing routes** continue to use `integrations_meta`, `meta_ad_accounts`, `meta_insights`, `campaigns` — no breaking changes.
- **New columns** are nullable; backfill runs in migration.
- **Canonical tables** are additive; no drops or renames of existing tables.

---

## Routes and Pages Requiring Adaptation

### Routes that need updates (when migrating to canonical model)

| Route | Current usage | Adaptation needed |
|-------|---------------|-------------------|
| `app/api/oauth/meta/callback/route.ts` | Creates `integrations_meta`, `meta_ad_accounts` | Create/upsert `integrations` row, set `integrations_meta.integrations_id`; create `ad_accounts` rows in addition to `meta_ad_accounts` |
| `app/api/oauth/meta/connections/save/route.ts` | Uses `integrations_meta`, `meta_ad_accounts` | Optionally sync `ad_accounts.is_enabled` when toggling `meta_ad_accounts.is_enabled` |
| `app/api/oauth/meta/connections/upsert/route.ts` | Uses `meta_connections` | No schema change; `meta_connections` stays. Future: consider `ad_account_connections` if unifying |
| `app/api/oauth/meta/accounts/route.ts` | Reads `meta_ad_accounts` | Can add fallback to `ad_accounts` when `meta_ad_accounts` empty but integration exists |
| `app/api/oauth/meta/connections/list/route.ts` | Reads `meta_ad_accounts` | Same as above |
| `app/lib/metaIntegration.ts` | Reads `integrations_meta` | No change; continues to work. Optional: resolve via `integrations` if needed |

### Routes that can stay unchanged (for now)

- `app/api/oauth/meta/start/route.ts` — uses `project_id` in state; no DB changes
- `app/api/oauth/meta/integration/validate/route.ts` — uses `getMetaIntegrationForProject()`; no change
- `app/api/oauth/meta/integration/status/route.ts` — reads `integrations_meta`; no change
- `app/api/oauth/meta/integration/current/route.ts` — reads `integrations_meta`; no change
- `app/api/oauth/meta/campaigns/route.ts` — reads `integrations_meta`; no change
- `app/api/oauth/meta/campaigns/sync/route.ts` — uses `integrations_meta`, `campaigns`; no change
- `app/api/oauth/meta/insights/sync/route.ts` — uses `integrations_meta`, `meta_insights`; no change
- `app/api/dashboard/*` — uses `project_id`; no change until org-scoped dashboards
- `app/api/health/route.ts` — reads `integrations_meta`, `meta_ad_accounts`, `meta_insights`; no change

### Pages that need adaptation (when adding org UX)

| Page | Current usage | Adaptation needed |
|------|---------------|-------------------|
| `app/app/page.tsx` | Uses `project_id` in URL | Add org context; optionally filter projects by `organization_id` |
| `app/app/accounts/page.tsx` | Uses `project_id` in URL | Same; ensure user has access to org/project |
| `app/app/components/Sidebar.tsx` | Uses `active_project_id` in localStorage | Add org switcher; filter projects by org |
| `app/app/layout.tsx` | App shell | Add org provider/context if needed |
| `app/login/page.tsx` | Auth only | No change |
| `app/reset/page.tsx` | Password reset | No change |

### New routes/pages to add (future)

- `GET /api/organizations` — list orgs for current user
- `GET /api/organizations/[id]/projects` — list projects in org
- `POST /api/organizations` — create org (for owners)
- Org switcher in Topbar/Sidebar
