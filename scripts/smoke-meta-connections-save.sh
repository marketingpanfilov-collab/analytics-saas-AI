#!/usr/bin/env bash
# Smoke: POST /api/oauth/meta/connections/save — expect JSON success or a clear 4xx;
# watch server logs for [CABINET_STATE] meta_connections_save_rpc_error (missing RPC) vs meta_connections_save_ok.
#
# Usage (browser session):
#   export BASE_URL=http://localhost:3000
#   export COOKIE='sb-...=...'   # copy from DevTools → Application → Cookies for your app host
#   export PROJECT_ID=<uuid>
#   export INTEGRATION_ID=<integrations_meta.id uuid>
#   export META_AD_ACCOUNT_IDS='["act_123"]'   # optional JSON array; default [] (disables all — use only on a throwaway project)
#
set -euo pipefail

BASE_URL="${BASE_URL:-http://localhost:3000}"
COOKIE="${COOKIE:-}"
PROJECT_ID="${PROJECT_ID:-}"
INTEGRATION_ID="${INTEGRATION_ID:-}"
# Valid JSON array literal, e.g. [] or ["act_123"]
META_AD_ACCOUNT_IDS="${META_AD_ACCOUNT_IDS:-[]}"

if [[ -z "$COOKIE" || -z "$PROJECT_ID" || -z "$INTEGRATION_ID" ]]; then
  echo "Set COOKIE, PROJECT_ID, INTEGRATION_ID (and optionally META_AD_ACCOUNT_IDS). See script header." >&2
  exit 1
fi

BODY="{\"project_id\":\"${PROJECT_ID}\",\"integration_id\":\"${INTEGRATION_ID}\",\"ad_account_ids\":${META_AD_ACCOUNT_IDS}}"

curl -sS -X POST "${BASE_URL%/}/api/oauth/meta/connections/save" \
  -H "Content-Type: application/json" \
  -H "Cookie: ${COOKIE}" \
  -d "$BODY"
echo
echo "Done. Check app logs for [CABINET_STATE] meta_connections_save_ok or meta_connections_save_rpc_error." >&2
