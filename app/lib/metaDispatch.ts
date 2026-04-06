import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Идемпотентная фиксация отправки Meta-события (CAPI). Ключ уникален на весь проект.
 */
export async function tryClaimMetaMarketingDispatch(
  admin: SupabaseClient,
  idempotencyKey: string,
  eventName: string
): Promise<boolean> {
  const { error } = await admin.from("meta_marketing_dispatch").insert({
    idempotency_key: idempotencyKey,
    event_name: eventName,
  });
  if (!error) return true;
  if ((error as { code?: string }).code === "23505") return false;
  console.error("[meta_dispatch] insert failed", error.message);
  return false;
}
