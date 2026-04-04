# PHASE 3 REPORT — QA & validation

## CJM scenarios (manual checklist)

Run on staging with real Paddle test mode where applicable. Mark pass/fail.

1. **New user** — Register → paywall (`BillingShellGate`) → checkout → post-checkout steps → first project.
2. **Post-checkout interrupt** — Stop at step 2 → re-login → same step restored.
3. **Invite** — Pending invite, email match → `INVITE_LOADING` until accept.
4. **Invite timeout** — Pending invite `created_at` &gt; 7s without membership → `INVITE_FALLBACK` / `INVITE_TIMEOUT`, retry + support CTAs.
5. **Unpaid** — Read-only shell; no successful heavy sync via API when gated.
6. **Grace / past_due** — Banner + `sync_refresh` only if allowed; payment restores green path.
7. **Upgrade + pending_plan_change** — Banner until webhook; simultaneous billing error shows billing (resolver priority).
8. **Downgrade** — Stricter banner + matrix limits from `plan_feature_matrix`.
9. **Over-limit** — Fullscreen when flag on; releasing usage unlocks.
10. **Refund** — `BILLING_REFUNDED` hard gate.
11. **Multi-tab** — Tab A changes plan → tab B receives broadcast and refetches bootstrap.
12. **Fallback** — Block `/api/billing/current-plan` → safe mode → retry recovers.
13. **NO_ACCESS_TO_ORG** — `NO_ORG_ACCESS` screen, not empty dashboard.
14. **client_safe_mode** — After retry exhaustion, limited UI; two successes clears safe mode.
15. **Contract version** — If server returned unknown `version`, `isBootstrapResponseValid` fails → capped fallback (no crash).

## Technical checks

| Check | Method |
|-------|--------|
| Auth on critical writes | `docs/billing/PHASE0_API_ROUTE_INVENTORY.md` + spot audit |
| Heavy sync + billing gate | Same inventory vs `requireBillingAccess` / heavy gates |
| UI shell vs raw state | `rg 'access_state\\|onboarding_state' app/app --glob '*.tsx'` — should trend to zero outside providers/debug |
| allowed_actions + server gate | Dashboard refresh gated; extend to other POST sync entrypoints |
| Fallback vs heavy POST | With safe mode / `BOOTSTRAP_UNAVAILABLE`, UI should not enable sync; server still enforces gate |
| intended_route safety | Attempt `?intended_route=https://evil.com` → ignored |
| Transition logs | Supabase `billing_ui_state_transitions` rows with `request_id`; dedup within ~4s |

## Status

Automated E2E not added in this slice; treat this document as the **release gate** for QA.
