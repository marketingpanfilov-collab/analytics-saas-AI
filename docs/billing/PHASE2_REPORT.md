# PHASE 2 REPORT — UX & product completeness

## Implemented (by execution-plan IDs)

| ID | Status | Notes |
|----|--------|--------|
| P2-UI-01 Shell from `screen` | Partial | `BillingShellGate` fullscreen for hard `PAYWALL`, `NO_ORG_ACCESS`, `OVER_LIMIT_*`, invite screens, `BILLING_REFUNDED`. Post-checkout remains dedicated modal. Not every `ScreenId` has a bespoke layout yet (e.g. `DEMO_SHELL`, `READ_ONLY_SHELL` soft modes rely on existing chrome + banners). |
| P2-UI-02 allowed_actions | Partial | `billingActionAllowed` + dashboard `sync_refresh` gate on `POST /api/dashboard/refresh` paths in `AppDashboardClient`. Other surfaces (OAuth modals, reports export) should be wired the same way in follow-up. |
| P2-UI-03 Data states | Pending | `data_state_default` on resolver; widget-level `EMPTY` / `LIMITED` / `BLOCKED` patterns not fully rolled through LTV/reports clients (see `docs/billing/DATA_STATE_WIDGET_PATTERNS.md` if present). |
| P2-UI-04 Over-limit | Done | Backend `over_limit_details`; fullscreen gate + copy when `over_limit_ui` flag on. |
| P2-UI-05 Post-checkout persistence | Pre-existing | `user_post_checkout_onboarding` + modal; not changed in this slice. |
| P2-UI-06 Banner vs modal | Partial | Hard blocks use gate; soft uses top banners (`PlanChangePending`, safe mode, stricter access). |
| P2-UI-07 No silent downgrade | Done | `BillingAccessStricterBanner` when `blocking_level` rank increases. |
| P2-UI-08 pending_plan_change | Done | Banner respects `feature_flags.pending_plan_banner`; billing still dominates via resolver order (Phase 0). |

## Feature flags (rollout §6)

Server: `getBillingFeatureFlagsPayload()` — env toggles default **on**, set to `"false"` to disable:

- `NEXT_PUBLIC_BILLING_BOOTSTRAP_V2` → `resolved_ui_shell`
- `NEXT_PUBLIC_BILLING_OVER_LIMIT_UI` → `over_limit_ui`
- `NEXT_PUBLIC_BILLING_PENDING_PLAN_BANNER` → `pending_plan_banner`
- `NEXT_PUBLIC_BILLING_CLIENT_GATING` → `client_gating`

Re-export: `app/lib/billingFeatureFlags.ts`.

## Files touched

- `app/app/components/BillingShellGate.tsx` — new.
- `app/app/(with-sidebar)/layout.tsx` — gate wraps main content.
- `app/app/components/BillingShellBanners.tsx` — flags + stricter-access banner.
- `app/app/AppDashboardClient.tsx` — `sync_refresh` allowed check.

## Verified

- `tsc` / `build` after changes.

## Gaps for a strict “P2 complete”

- Grep-driven removal of all shell branching on `access_state` in `app/app/**` (policy P0-CON-03 / P2-UI-01 DoD).
- `export` and OAuth flows guarded by `allowed_actions` everywhere per ACTION_MATRIX.
