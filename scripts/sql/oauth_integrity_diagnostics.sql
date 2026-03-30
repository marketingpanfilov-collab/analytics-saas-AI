-- OAuth / integrations diagnostics (run in Supabase SQL editor or psql).
-- Read-only checks; does not modify data.

-- 1) Google / TikTok: connected integrations missing refresh_token (no proactive sweep / silent renewal).
SELECT i.id AS integration_id,
       i.project_id,
       i.platform,
       a.id AS auth_row_id,
       (a.refresh_token IS NULL OR btrim(a.refresh_token) = '') AS refresh_missing,
       a.token_expires_at
FROM public.integrations i
JOIN public.integrations_auth a ON a.integration_id = i.id
WHERE i.platform IN ('google', 'tiktok')
  AND (a.refresh_token IS NULL OR btrim(a.refresh_token) = '')
ORDER BY i.platform, i.project_id;

-- 2) Orphan integrations_auth rows (should be empty if FK is enforced).
SELECT a.id,
       a.integration_id,
       a.created_at
FROM public.integrations_auth a
LEFT JOIN public.integrations i ON i.id = a.integration_id
WHERE i.id IS NULL;

-- 3) Per project: canonical integration id vs auth row (detect wrong integration_id on auth).
SELECT i.project_id,
       i.platform,
       i.id AS integrations_table_id,
       a.integration_id AS auth_integration_id,
       (i.id = a.integration_id) AS ids_match
FROM public.integrations i
LEFT JOIN public.integrations_auth a ON a.integration_id = i.id
WHERE i.platform IN ('meta', 'google', 'tiktok')
ORDER BY i.project_id, i.platform;

-- 4) Integrations without any integrations_auth row (OAuth never saved or deleted).
SELECT i.id AS integration_id,
       i.project_id,
       i.platform,
       i.created_at
FROM public.integrations i
LEFT JOIN public.integrations_auth a ON a.integration_id = i.id
WHERE i.platform IN ('google', 'tiktok', 'meta')
  AND a.id IS NULL
ORDER BY i.platform, i.project_id;
