import { safeAppNextTarget } from "@/app/lib/auth/safeAppNextTarget";
import { runFinalizeLoginCheckoutCore } from "@/app/lib/auth/finalizeLoginCheckoutCore";
import { supabaseAdmin } from "@/app/lib/supabaseAdmin";

const DEFAULT_AFTER_CONFIRM = "/app/projects";

/**
 * Куда редиректить после того, как сессия уже в cookies (клиент разобрал hash implicit или обменял PKCE-code).
 * Логика совпадает с бывшим GET /auth/callback.
 */
export async function resolveEmailCallbackContinuePath(
  origin: string,
  nextRaw: string | null,
  user: { id: string; email: string | undefined }
): Promise<string> {
  const safeNext = safeAppNextTarget(nextRaw, origin) ?? DEFAULT_AFTER_CONFIRM;
  let redirectPath = safeNext;

  const email = user.email;
  if (!email) return redirectPath;

  const emailNorm = email.trim().toLowerCase();
  const admin = supabaseAdmin();
  const { data: openIntent } = await admin
    .from("billing_login_checkout_intents")
    .select("organization_id")
    .eq("email_normalized", emailNorm)
    .is("linked_at", null)
    .maybeSingle();

  if (openIntent?.organization_id) {
    const fin = await runFinalizeLoginCheckoutCore(admin, {
      userId: user.id,
      sessionEmailNormalized: emailNorm,
      organizationId: String(openIntent.organization_id),
    });

    if (fin.ok) {
      redirectPath = safeNext;
    } else if (fin.code === "subscription_not_active_yet") {
      const recovery = new URL("/auth/finalize-signup-checkout", origin);
      recovery.searchParams.set("next", safeNext);
      redirectPath = `${recovery.pathname}${recovery.search}`;
    } else if (fin.code === "already_finalized") {
      redirectPath = safeNext;
    } else {
      const recovery = new URL("/auth/finalize-signup-checkout", origin);
      recovery.searchParams.set("next", safeNext);
      recovery.searchParams.set("finalize_error", fin.code);
      redirectPath = `${recovery.pathname}${recovery.search}`;
    }
  }

  return redirectPath;
}
