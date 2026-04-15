import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Идемпотентная фиксация отправки Meta-события (CAPI). Ключ уникален на весь проект.
 */
export async function tryClaimMetaMarketingDispatch(
  admin: SupabaseClient,
  idempotencyKey: string,
  eventName: string
): Promise<boolean> {
  const r = await tryClaimMetaMarketingDispatchDetailed(admin, idempotencyKey, eventName);
  return r === "claimed";
}

export type ClaimMetaMarketingDispatchResult = "claimed" | "duplicate" | "failed";

/** Дубликат (23505) отдельно от прочих ошибок — нужен для CompleteRegistration + cookie. */
export async function tryClaimMetaMarketingDispatchDetailed(
  admin: SupabaseClient,
  idempotencyKey: string,
  eventName: string
): Promise<ClaimMetaMarketingDispatchResult> {
  const { error } = await admin.from("meta_marketing_dispatch").insert({
    idempotency_key: idempotencyKey,
    event_name: eventName,
  });
  if (!error) return "claimed";
  if ((error as { code?: string }).code === "23505") return "duplicate";
  console.error("[meta_dispatch] insert failed", error.message);
  return "failed";
}

/** Откат слота после неуспешного Graph — иначе повтор save_company не отправит событие. */
export async function releaseMetaMarketingDispatch(
  admin: SupabaseClient,
  idempotencyKey: string
): Promise<void> {
  const { error } = await admin.from("meta_marketing_dispatch").delete().eq("idempotency_key", idempotencyKey);
  if (error) console.error("[meta_dispatch] release failed", error.message);
}
