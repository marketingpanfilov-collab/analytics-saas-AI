/**
 * Server-only. Unified project access for dashboard and sync API.
 * - With valid user session: requires requireProjectAccess(user.id, projectId).
 * - With internal bypass header (X-Internal-Sync-Secret === INTERNAL_SYNC_SECRET): allows request without user (for backfill/server-to-server sync).
 * Use internal bypass only from server code (e.g. ensureBackfill calling POST /api/dashboard/sync); never expose the secret to the client.
 */

import { createServerSupabase } from "@/app/lib/supabaseServer";
import { requireProjectAccess } from "@/app/lib/auth/requireProjectAccess";

const INTERNAL_HEADER = "x-internal-sync-secret";

/** True when request carries a valid internal sync secret (server-to-server only). */
export function isInternalSyncRequest(request: Request): boolean {
  const secret = process.env.INTERNAL_SYNC_SECRET;
  const headerSecret = request.headers.get(INTERNAL_HEADER) ?? request.headers.get(INTERNAL_HEADER.toLowerCase());
  return typeof secret === "string" && secret.length > 0 && headerSecret === secret;
}

export type ProjectAccessCheckResult =
  | { allowed: true; source: "internal" }
  | { allowed: true; source: "user"; userId: string }
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

  if (allowInternalBypass) {
    const envPresent = typeof secret === "string" && secret.length > 0;
    if (!envPresent && headerSecret) {
      console.warn("[INTERNAL_SYNC_SECRET_MISSING]", {
        projectId,
        message: "INTERNAL_SYNC_SECRET is not set but x-internal-sync-secret was sent",
      });
    }
    if (envPresent && headerSecret === secret) {
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

  return { allowed: true, source: "user", userId: user.id };
}

/** Header to send when calling sync from server (e.g. backfill). Only use in server-side code. */
export function getInternalSyncHeaders(): Record<string, string> {
  const secret = process.env.INTERNAL_SYNC_SECRET;
  const hasSecret = typeof secret === "string" && secret.length > 0;
  if (!hasSecret) return {};
  return { [INTERNAL_HEADER]: secret };
}
