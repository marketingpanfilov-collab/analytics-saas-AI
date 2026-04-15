import type { SupabaseClient } from "@supabase/supabase-js";
import { supabaseAdmin } from "@/app/lib/supabaseAdmin";
import {
  META_COMPLETE_REGISTRATION_ELIGIBLE_COOKIE,
  parseCookieFromRequestHeader,
} from "@/app/lib/metaCompleteRegistrationCookie";

/**
 * Серверный маркер «после подтверждения signup из письма» — переживает смену браузера/устройства.
 * JWT сессии может отставать от auth.users; для чтения eligibility используйте getUserById ниже.
 */
export const META_CR_ELIGIBLE_USER_METADATA_KEY = "boardiq_meta_cr_eligible";

export function userMetadataIndicatesMetaCrEligible(userMetadata: Record<string, unknown> | null | undefined): boolean {
  if (!userMetadata || typeof userMetadata !== "object") return false;
  const v = userMetadata[META_CR_ELIGIBLE_USER_METADATA_KEY];
  return v === true || v === "true" || v === 1 || v === "1";
}

/** Cookie (тот же браузер) или флаг в auth.users.user_metadata (любое устройство после verify). */
export async function isUserEligibleForMetaCompleteRegistrationCapi(
  admin: SupabaseClient,
  req: Request,
  userId: string
): Promise<boolean> {
  if (parseCookieFromRequestHeader(req, META_COMPLETE_REGISTRATION_ELIGIBLE_COOKIE) === "1") {
    return true;
  }
  const { data, error } = await admin.auth.admin.getUserById(userId);
  if (error || !data?.user?.user_metadata) return false;
  return userMetadataIndicatesMetaCrEligible(data.user.user_metadata as Record<string, unknown>);
}

export async function setMetaCompleteRegistrationEligibleForUser(userId: string): Promise<void> {
  try {
    const admin = supabaseAdmin();
    const { data: cur, error: gErr } = await admin.auth.admin.getUserById(userId);
    if (gErr || !cur.user) {
      console.error("[meta_cr_eligible] getUserById", gErr?.message);
      return;
    }
    const md = {
      ...(cur.user.user_metadata as Record<string, unknown> | null | undefined),
      [META_CR_ELIGIBLE_USER_METADATA_KEY]: true,
    };
    const { error } = await admin.auth.admin.updateUserById(userId, { user_metadata: md });
    if (error) console.error("[meta_cr_eligible] updateUserById", error.message);
  } catch (e) {
    console.error("[meta_cr_eligible] set", e);
  }
}

export async function clearMetaCompleteRegistrationEligibleForUser(userId: string): Promise<void> {
  try {
    const admin = supabaseAdmin();
    const { data: cur, error: gErr } = await admin.auth.admin.getUserById(userId);
    if (gErr || !cur.user) return;
    const raw = (cur.user.user_metadata ?? {}) as Record<string, unknown>;
    if (!(META_CR_ELIGIBLE_USER_METADATA_KEY in raw)) return;
    const md = { ...raw };
    delete md[META_CR_ELIGIBLE_USER_METADATA_KEY];
    const { error } = await admin.auth.admin.updateUserById(userId, { user_metadata: md });
    if (error) console.error("[meta_cr_eligible] clear updateUserById", error.message);
  } catch (e) {
    console.error("[meta_cr_eligible] clear", e);
  }
}
