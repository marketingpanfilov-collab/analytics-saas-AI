# PHASE 1 REPORT — Stability & consistency

## Implemented (by execution-plan IDs)

| ID | Status | Notes |
|----|--------|--------|
| P1-RUN-01 Multi-tab | Done | `BroadcastChannel` listener in `BillingBootstrapProvider`; `broadcastBillingBootstrapInvalidate()` after successful bootstrap when `fingerprintResolvedUi` changes vs previous success. |
| P1-RUN-02 Retry bootstrap | Done | Existing 1s / 3s / 5s backoff; **P1-RUN-04**: single `request_id` per `runBootstrap` attempt (all retries share `x-request-id`). |
| P1-RUN-03 stabilization_window | Done | `BILLING_STABILIZATION_WINDOW_MS` (450ms) debounce for non-immediate reasons before applying `resolved_ui_state` to display. |
| P1-RUN-04 request_id | Done | Client retries reuse one id; responses echo `request_id`; redirect-cap logs include `request_id`. |
| P1-RUN-05 Transitions + dedup | Done | `POST /api/billing/ui-transition` + `client_shell` source; server dedup in `logBillingUiTransition`; client skips duplicate POST within 4s and skips when same fp as fresh bootstrap (&lt;2.5s). Migration extends `source` CHECK for `client_shell`. |
| P1-RES-01 Invite resolver | Done | `invite_pending`: `none` \| `waiting` \| `timeout` (7s from `created_at`); `INVITE_FALLBACK` + `INVITE_TIMEOUT` vs `INVITE_LOADING` + `INVITE_PENDING`. |
| P1-RES-02 NO_ACCESS_TO_ORG | Done | Already `NO_ORG_ACCESS` + `NO_ACCESS_TO_ORG` in resolver; surfaced in `BillingShellGate`. |
| P1-RTE-01 redirect loop | Done | `MAX_SHELL_REDIRECT_DEPTH` + `[BILLING_SHELL_REDIRECT_CAP]` console warning with metadata. |
| P1-RTE-02 intended_route | Done | Existing `validateIntendedRoute` (unchanged). |
| P1-SAFE-01 client_safe_mode | Done | Fallback paths set safe mode; exit after 2 consecutive successes; `[BILLING_BOOTSTRAP_FALLBACK]` warnings. |

## Files touched (this slice)

- `app/lib/billingShellResolver.ts` — `InvitePendingShell`, invite timeout branch.
- `app/lib/billingCurrentPlan.ts` — `computeInvitePendingState`, `feature_flags` payload, enrichment.
- `app/api/billing/current-plan/route.ts` — `feature_flags` in JSON.
- `app/api/billing/ui-transition/route.ts` — new.
- `supabase/migrations/20260401120000_billing_ui_transition_client_shell.sql` — `client_shell` source.
- `app/lib/billingBootstrapClient.ts` — stabilization constant, feature flags helpers, `billingActionAllowed`.
- `app/app/components/BillingBootstrapProvider.tsx` — stabilization, broadcast, single request_id, logging effect, monitoring logs.

## Verified

- `npx tsc --noEmit` — pass.
- `npm run build` — pass.

## Residual risk

- `computeInvitePendingState` does N+1 queries per pending invite (acceptable at low volume; optimize with batch if needed).
- `client_shell` logging requires DB migration applied in production before inserts succeed.
