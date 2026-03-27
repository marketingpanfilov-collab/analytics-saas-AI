# Authorized Ads Stabilization Rollout Checklist

## Feature flag
- `FEATURE_UNIFIED_TOKEN_HEALTH=0` (default safe mode)
  - Legacy conservative behavior, invalid OAuth mostly maps to `disconnected`.
- `FEATURE_UNIFIED_TOKEN_HEALTH=1`
  - Enables unified token health diagnostics and temporary OAuth degradation handling.

## Stage 1: Audit + observability only
- Deploy with `FEATURE_UNIFIED_TOKEN_HEALTH=0`.
- Verify new logs:
  - `[INTEGRATION_STATUS_ROW]`
- Validate API auth on account selection endpoints:
  - `/api/oauth/meta/accounts`
  - `/api/oauth/google/accounts`
  - `/api/oauth/tiktok/accounts`
  - `/api/oauth/*/connections/save`

## Stage 2: Enable unified token health
- Set `FEATURE_UNIFIED_TOKEN_HEALTH=1` in staging.
- Check expected behavior:
  - transient OAuth issues produce `stale` instead of immediate `disconnected`;
  - response has `token_reason_code` and `last_recovery_attempt_at`.

## Stage 3: Production rollout
- Enable flag for production.
- Monitor first 24-48h:
  - ratio of `disconnected` vs `stale`;
  - frequency of `refresh_failed`;
  - time-to-recover after re-auth.

## Smoke scenarios
1. Reconnect OAuth and verify status returns to `healthy`.
2. Revoke provider permission and verify `token_reason_code=permissions_revoked`.
3. Wait until token expiry and verify refresh path:
   - Google/TikTok should attempt auto refresh.
4. Deselect an account in connections/save and verify:
   - not shown in dashboard account list (`selected_only=1`),
   - excluded from sync runs.

