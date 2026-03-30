-- Persist optional ad platform ids from /r/{token}?campaign_id=… for LTV retention spend matching.

ALTER TABLE public.redirect_click_events
  ADD COLUMN IF NOT EXISTS platform_campaign_id text,
  ADD COLUMN IF NOT EXISTS platform_adset_id text,
  ADD COLUMN IF NOT EXISTS platform_ad_id text;

COMMENT ON COLUMN public.redirect_click_events.platform_campaign_id IS 'From /r query campaign_id; matched with campaigns.meta_campaign_id / external_campaign_id for retention spend.';
COMMENT ON COLUMN public.redirect_click_events.platform_adset_id IS 'From /r query adset_id; stored for diagnostics / future use.';
COMMENT ON COLUMN public.redirect_click_events.platform_ad_id IS 'From /r query ad_id; stored for diagnostics / future use.';

-- Replace RPC with extended signature (add 3 params at end).
DROP FUNCTION IF EXISTS public.log_redirect_click_and_increment(
  uuid, uuid, text, text, text, text, text, text, text, text, text, text, text, text, text, text, text, text, text, text, text, text, text, text
);

CREATE OR REPLACE FUNCTION public.log_redirect_click_and_increment(
  p_link_id uuid,
  p_project_id uuid,
  p_bq_click_id text,
  p_destination_url text,
  p_full_url text,
  p_utm_source text,
  p_utm_medium text,
  p_utm_campaign text,
  p_utm_content text,
  p_utm_term text,
  p_utm_id text,
  p_campaign_intent text,
  p_fbclid text,
  p_gclid text,
  p_ttclid text,
  p_yclid text,
  p_referrer text,
  p_user_agent text,
  p_ip text,
  p_fbp text,
  p_fbc text,
  p_fingerprint_hash text,
  p_traffic_source text,
  p_traffic_platform text,
  p_platform_campaign_id text,
  p_platform_adset_id text,
  p_platform_ad_id text
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.redirect_click_events (
    project_id,
    redirect_link_id,
    bq_click_id,
    destination_url,
    full_url,
    utm_source,
    utm_medium,
    utm_campaign,
    utm_content,
    utm_term,
    utm_id,
    campaign_intent,
    fbclid,
    gclid,
    ttclid,
    yclid,
    referrer,
    user_agent,
    ip,
    fbp,
    fbc,
    fingerprint_hash,
    traffic_source,
    traffic_platform,
    platform_campaign_id,
    platform_adset_id,
    platform_ad_id
  ) VALUES (
    p_project_id,
    p_link_id,
    p_bq_click_id,
    p_destination_url,
    p_full_url,
    p_utm_source,
    p_utm_medium,
    p_utm_campaign,
    p_utm_content,
    p_utm_term,
    p_utm_id,
    p_campaign_intent,
    p_fbclid,
    p_gclid,
    p_ttclid,
    p_yclid,
    p_referrer,
    p_user_agent,
    p_ip,
    p_fbp,
    p_fbc,
    p_fingerprint_hash,
    p_traffic_source,
    p_traffic_platform,
    p_platform_campaign_id,
    p_platform_adset_id,
    p_platform_ad_id
  );

  UPDATE public.redirect_links
  SET clicks_count = COALESCE(clicks_count, 0) + 1,
      last_click_at = now()
  WHERE id = p_link_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.log_redirect_click_and_increment(
  uuid, uuid, text, text, text, text, text, text, text, text, text, text, text, text, text, text, text, text, text, text, text, text, text, text, text, text, text
) TO anon, authenticated, service_role;
