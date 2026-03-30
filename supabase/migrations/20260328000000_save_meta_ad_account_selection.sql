-- Atomic meta_ad_accounts enable/disable for one integrations_meta row (avoids partial two-step failure).
CREATE OR REPLACE FUNCTION public.save_meta_ad_account_selection(
  p_project_id uuid,
  p_integration_meta_id uuid,
  p_ad_account_ids text[]
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE public.meta_ad_accounts
  SET is_enabled = false
  WHERE project_id = p_project_id
    AND integration_id = p_integration_meta_id
    AND is_enabled = true;

  IF p_ad_account_ids IS NOT NULL AND cardinality(p_ad_account_ids) > 0 THEN
    UPDATE public.meta_ad_accounts
    SET is_enabled = true,
        integration_id = p_integration_meta_id
    WHERE project_id = p_project_id
      AND ad_account_id = ANY (p_ad_account_ids);
  END IF;
END;
$$;

COMMENT ON FUNCTION public.save_meta_ad_account_selection(uuid, uuid, text[]) IS
  'Disables all enabled meta_ad_accounts for the given integrations_meta row, then enables listed ad_account_ids for the project (single transaction).';

GRANT EXECUTE ON FUNCTION public.save_meta_ad_account_selection(uuid, uuid, text[]) TO service_role;
