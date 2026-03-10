-- Platform-agnostic account state: selection, sync, reporting.
-- One row per ad account (ad_accounts.id). project_id stored for filtering.

CREATE TABLE IF NOT EXISTS public.ad_account_settings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  ad_account_id uuid NOT NULL REFERENCES public.ad_accounts(id) ON DELETE CASCADE,
  project_id uuid NOT NULL,
  is_enabled boolean NOT NULL DEFAULT false,
  selected_for_reporting boolean NOT NULL DEFAULT true,
  sync_enabled boolean NOT NULL DEFAULT false,
  last_sync_at timestamptz NULL,
  last_sync_status text NULL,
  last_sync_error text NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (ad_account_id)
);

CREATE INDEX IF NOT EXISTS idx_ad_account_settings_project_id ON public.ad_account_settings(project_id);
CREATE INDEX IF NOT EXISTS idx_ad_account_settings_ad_account_id ON public.ad_account_settings(ad_account_id);

-- Backfill from meta_ad_accounts: map (project_id, ad_account_id act_*) -> ad_accounts.id via integrations
INSERT INTO public.ad_account_settings (
  ad_account_id,
  project_id,
  is_enabled,
  selected_for_reporting,
  sync_enabled,
  created_at,
  updated_at
)
SELECT
  aa.id,
  ma.project_id,
  COALESCE(ma.is_enabled, false),
  COALESCE(ma.is_enabled, true),
  false,
  now(),
  now()
FROM public.meta_ad_accounts ma
JOIN public.integrations i ON i.project_id = ma.project_id AND i.platform = 'meta'
JOIN public.ad_accounts aa ON aa.integration_id = i.id AND aa.external_account_id = ma.ad_account_id
WHERE NOT EXISTS (
  SELECT 1 FROM public.ad_account_settings s WHERE s.ad_account_id = aa.id
)
ON CONFLICT (ad_account_id) DO NOTHING;

-- Sync is_enabled/selected_for_reporting from meta_ad_accounts for already-existing settings (backward compat)
UPDATE public.ad_account_settings s
SET
  is_enabled = ma.is_enabled,
  selected_for_reporting = COALESCE(ma.is_enabled, s.selected_for_reporting),
  updated_at = now()
FROM public.meta_ad_accounts ma
JOIN public.integrations i ON i.project_id = ma.project_id AND i.platform = 'meta'
JOIN public.ad_accounts aa ON aa.integration_id = i.id AND aa.external_account_id = ma.ad_account_id
WHERE s.ad_account_id = aa.id AND s.project_id = ma.project_id;
