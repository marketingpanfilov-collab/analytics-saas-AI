import type { SupabaseClient } from "@supabase/supabase-js";

export type MetaCheckoutCapiContextRow = {
  client_user_agent: string | null;
  event_source_url: string | null;
  client_ip: string | null;
  fbp: string | null;
  fbc: string | null;
};

export async function upsertMetaCheckoutCapiContext(
  admin: SupabaseClient,
  row: {
    checkout_attempt_id: string;
    client_user_agent: string | null;
    event_source_url: string | null;
    client_ip: string | null;
    fbp: string | null;
    fbc: string | null;
  }
): Promise<void> {
  const existing = await getMetaCheckoutCapiContext(admin, row.checkout_attempt_id);
  const incomingUa = row.client_user_agent?.trim() || null;
  const existingUa = existing?.client_user_agent?.trim() || null;
  const client_user_agent = incomingUa || existingUa || null;

  const { error } = await admin.from("meta_checkout_capi_context").upsert(
    {
      checkout_attempt_id: row.checkout_attempt_id,
      client_user_agent,
      event_source_url: row.event_source_url,
      client_ip: row.client_ip,
      fbp: row.fbp,
      fbc: row.fbc,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "checkout_attempt_id" }
  );
  if (error) console.error("[meta_checkout_capi_context] upsert", error.message);
}

export async function getMetaCheckoutCapiContext(
  admin: SupabaseClient,
  checkoutAttemptId: string
): Promise<MetaCheckoutCapiContextRow | null> {
  const { data, error } = await admin
    .from("meta_checkout_capi_context")
    .select("client_user_agent,event_source_url,client_ip,fbp,fbc")
    .eq("checkout_attempt_id", checkoutAttemptId)
    .maybeSingle();
  if (error) {
    console.error("[meta_checkout_capi_context] select", error.message);
    return null;
  }
  if (!data) return null;
  return data as MetaCheckoutCapiContextRow;
}
