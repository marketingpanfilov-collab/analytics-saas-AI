/**
 * Server-only. Unified project access for dashboard and sync API.
 * - With valid user session: requires requireProjectAccess(user.id, projectId).
 * - With internal bypass header (X-Internal-Sync-Secret === INTERNAL_SYNC_SECRET): allows request without user (for backfill/server-to-server sync).
 * Use internal bypass only from server code (e.g. ensureBackfill calling POST /api/dashboard/sync); never expose the secret to the client.
 */

import { createServerSupabase } from "@/app/lib/supabaseServer";
import { requireProjectAccess } from "@/app/lib/auth/requireProjectAccess";

const INTERNAL_HEADER = "x-internal-sync-secret";

export type ProjectAccessCheckResult =
  | { allowed: true; source: "user" | "internal" }
  | { allowed: false; status: 401 | 403; body: { success: false; error: string } };

export type RequireProjectAccessOptions = {
  /** When true, allow server-only bypass via X-Internal-Sync-Secret (e.g. for POST /api/dashboard/sync from backfill). */
  allowInternalBypass?: boolean;
};

/**
 * Returns whether the request is allowed to act on projectId.
 * - If allowInternalBypass and X-Internal-Sync-Secret is present and matches INTERNAL_SYNC_SECRET, allowed (source: "internal").
 * - Else requires authenticated user with requireProjectAccess(user.id, projectId).
 */
export async function requireProjectAccessOrInternal(
  request: Request,
  projectId: string,
  options?: RequireProjectAccessOptions
): Promise<ProjectAccessCheckResult> {
  const allowInternalBypass = options?.allowInternalBypass === true;
  const secret = process.env.INTERNAL_SYNC_SECRET;
  const headerSecret = request.headers.get(INTERNAL_HEADER) ?? request.headers.get(INTERNAL_HEADER.toLowerCase());
  const hasHeader = !!headerSecret;

  console.log("[BACKFILL_INTERNAL_SECRET_PRESENT]", {
    projectId,
    allowInternalBypass,
    hasHeader,
  });

  if (allowInternalBypass) {
    const envPresent = typeof secret === "string" && secret.length > 0;
    console.log("[INTERNAL_BYPASS_CHECK]", {
      projectId,
      allowInternalBypass,
      hasHeader,
      envSecretPresent: envPresent,
    });
    if (!envPresent) {
      console.log("[INTERNAL_SYNC_SECRET_MISSING]", {
        projectId,
        message: "INTERNAL_SYNC_SECRET is not set; internal bypass disabled",
      });
    }
    if (envPresent && headerSecret === secret) {
      console.log("[INTERNAL_BYPASS_CHECK]", {
        projectId,
        allowInternalBypass,
        hasHeader,
        envSecretPresent: envPresent,
        outcome: "allowed_internal",
      });
      return { allowed: true, source: "internal" };
    }
  }

  const supabase = await createServerSupabase();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return {
      allowed: false,
      status: 401,
      body: { success: false, error: "Unauthorized" },
    };
  }

  const access = await requireProjectAccess(user.id, projectId);
  if (!access) {
    return {
      allowed: false,
      status: 403,
      body: { success: false, error: "Project access denied" },
    };
  }

  return { allowed: true, source: "user" };
}

/** Header to send when calling sync from server (e.g. backfill). Only use in server-side code. */
export function getInternalSyncHeaders(): Record<string, string> {
  const secret = process.env.INTERNAL_SYNC_SECRET;
  const hasSecret = typeof secret === "string" && secret.length > 0;
  console.log("[INTERNAL_SYNC_HEADERS_BUILD]", {
    hasSecret,
  });
  if (!hasSecret) return {};
  return { [INTERNAL_HEADER]: secret };
}
