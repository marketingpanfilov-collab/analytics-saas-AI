# Authorized Ads Token Audit Matrix

## Scope
- Platforms: `Meta`, `Google Ads`, `TikTok Ads`
- Goal: map symptoms to root causes and exact code paths for recovery/stabilization.

## Token lifecycle by platform

| Platform | Token storage | Refresh behavior | Main validator in runtime |
|---|---|---|---|
| Meta | `integrations_meta.access_token` + `integrations_auth.access_token` | No refresh token flow; token is long-lived from callback | `getMetaTokenHealth()` |
| Google | `integrations_auth.access_token`, `refresh_token`, `token_expires_at` | Refresh via `oauth2.googleapis.com/token` grant `refresh_token` | `getGoogleTokenHealth()` -> `getValidGoogleAccessToken()` |
| TikTok | `integrations_auth.access_token`, `refresh_token`, `token_expires_at` | Refresh via `business-api.tiktok.com/open_api/v1.3/oauth2/access_token/` grant `refresh_token` | `getTikTokTokenHealth()` -> `getValidTikTokAccessToken()` |

## Symptom -> root cause -> code path

| Symptom | Likely root cause | Where it appears |
|---|---|---|
| Integration becomes `disconnected` immediately after inactivity | Expired token with no refresh path (Meta) or refresh failed (Google/TikTok) | `app/api/oauth/integration/status/route.ts` + `app/lib/tokenHealth.ts` |
| `stale` while OAuth still valid | No fresh rows in `daily_ad_metrics` or sync too old | `resolveDataStatus()` in `app/api/oauth/integration/status/route.ts` |
| Sync returns 401 from provider | Revoked permissions / invalid token | Platform sync routes in `app/api/oauth/*/insights/sync/route.ts` |
| Account list visible but sync misses expected accounts | Account is not enabled in `ad_account_settings` | `app/api/dashboard/sync/route.ts` + connections/save routes |
| UI shows confusing generic error | Missing diagnostic reason propagation | `app/api/oauth/integration/status/route.ts` and dashboard UI status card |

## Current recovery behavior

- Google/TikTok:
  - if access token expired and refresh token exists, runtime tries refresh automatically;
  - on success, `integrations_auth` token is updated.
- Meta:
  - no runtime refresh; token health relies on expiry + debug token validity.

## Added unified reason codes

- `ok`
- `not_connected`
- `token_expired`
- `refresh_failed`
- `permissions_revoked`
- `account_unavailable`
- `token_missing`
- `temporary_oauth_failure`

## Notes

- Unified token health is designed for phased rollout with feature flag:
  - `FEATURE_UNIFIED_TOKEN_HEALTH=1` enables temporary degradation (`stale` for transient OAuth failures) and richer diagnostics.
- Without flag, system keeps strict conservative behavior (mostly `disconnected` on OAuth invalid).

