import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/app/lib/supabaseAdmin";
import { checkRateLimit } from "@/app/lib/security/rateLimit";
import { getInternalSyncHeaders } from "@/app/lib/auth/requireProjectAccessOrInternal";
import { runOAuthTokenRefreshSweep } from "@/app/lib/oauthRefreshCron";
import { parseBearerToken } from "@/app/lib/auth/parseBearerAuth";

const INTERNAL_HEADER = "x-internal-sync-secret";

const ACTIVE_SUBSCRIPTION_STATUSES = new Set(["active", "trialing", "past_due"]);

function todayYmd(): string {
  return new Date().toISOString().slice(0, 10);
}

function isUserActiveEntitlement(row: {
  user_id: string | null;
  starts_at?: string | null;
  ends_at?: string | null;
  status?: string | null;
}): boolean {
  if (!row.user_id) return false;
  if (row.status && row.status !== "active") return false;
  const nowTs = Date.now();
  const startsTs = row.starts_at ? Date.parse(String(row.starts_at)) : null;
  const endsTs = row.ends_at ? Date.parse(String(row.ends_at)) : null;
  if (startsTs != null && Number.isFinite(startsTs) && nowTs < startsTs) return false;
  if (endsTs != null && Number.isFinite(endsTs) && nowTs > endsTs) return false;
  return true;
}

function isProviderSubscriptionActive(row: {
  provider_customer_id: string | null;
  status?: string | null;
  current_period_end?: string | null;
}): boolean {
  if (!row.provider_customer_id) return false;
  if (!row.status) return false;
  if (!ACTIVE_SUBSCRIPTION_STATUSES.has(String(row.status).toLowerCase())) return false;
  const nowTs = Date.now();
  const endTs = row.current_period_end ? Date.parse(String(row.current_period_end)) : null;
  if (endTs != null && Number.isFinite(endTs) && nowTs > endTs) return false;
  return true;
}

async function authorizeInternalCron(req: Request): Promise<boolean> {
  const internalSecret = process.env.INTERNAL_SYNC_SECRET;
  const cronSecret = process.env.CRON_SECRET;

  const headerSecret = req.headers.get(INTERNAL_HEADER) ?? req.headers.get(INTERNAL_HEADER.toLowerCase());
  if (typeof internalSecret === "string" && internalSecret.length > 0 && headerSecret === internalSecret) return true;

  const bearer = parseBearerToken(req.headers.get("authorization"));
  if (typeof cronSecret === "string" && cronSecret.length > 0 && bearer === cronSecret) return true;

  // Convenience fallback: if CRON_SECRET is not set in Vercel, allow Bearer INTERNAL_SYNC_SECRET.
  if (typeof internalSecret === "string" && internalSecret.length > 0 && bearer === internalSecret) return true;

  console.log("[INTERNAL_SYNC_CRON_UNAUTHORIZED]", {
    internalHeaderPresent: !!headerSecret,
    bearerPresent: !!bearer,
    envInternalSet: typeof internalSecret === "string" && internalSecret.length > 0,
    envCronSet: typeof cronSecret === "string" && cronSecret.length > 0,
  });

  return false;
}

async function getPaidUserIds(admin: ReturnType<typeof supabaseAdmin>): Promise<Set<string>> {
  const nowIso = new Date().toISOString();
  const nowTs = Date.parse(nowIso);
  if (!Number.isFinite(nowTs)) return new Set();

  const paid = new Set<string>();

  // 1) Admin entitlements (status=active + time window checks)
  const { data: entRows } = await admin
    .from("billing_entitlements")
    .select("user_id, starts_at, ends_at, status")
    .eq("status", "active")
    .limit(5000);

  for (const row of entRows ?? []) {
    if (!isUserActiveEntitlement(row as any)) continue;
    paid.add(String((row as any).user_id));
  }

  // 2) Provider subscriptions snapshot (Paddle -> billing_customer_map -> user_id)
  const { data: subsRows } = await admin
    .from("billing_subscriptions")
    .select("provider_customer_id, status, current_period_end")
    .eq("provider", "paddle")
    .limit(5000);

  const activeCustomerIds = new Set<string>();
  for (const row of subsRows ?? []) {
    const r = row as any;
    if (!isProviderSubscriptionActive(r)) continue;
    activeCustomerIds.add(String(r.provider_customer_id));
  }

  if (activeCustomerIds.size > 0) {
    const customerIds = Array.from(activeCustomerIds).slice(0, 5000);
    const { data: maps } = await admin
      .from("billing_customer_map")
      .select("provider_customer_id, user_id")
      .eq("provider", "paddle")
      .in("provider_customer_id", customerIds);

    for (const m of maps ?? []) {
      const userId = (m as any).user_id;
      if (!userId) continue;
      paid.add(String(userId));
    }
  }

  return paid;
}

async function getPaidActiveProjectIds(admin: ReturnType<typeof supabaseAdmin>, paidUserIds: Set<string>): Promise<string[]> {
  const paidArr = Array.from(paidUserIds);
  if (paidArr.length === 0) return [];

  const MAX_IDS = 2000; // prevent gigantic .in() calls
  const paidUserIdsCapped = paidArr.slice(0, MAX_IDS);

  // Projects must:
  // - be accessible by paid users (org role or project member)
  // - not be archived
  // - have at least one enabled ad account (ad_account_settings.is_enabled=true)

  // 1) enabled projects (cheap coarse filter)
  const { data: enabledRows } = await admin
    .from("ad_account_settings")
    .select("project_id")
    .eq("is_enabled", true)
    .limit(20000);
  const enabledProjects = new Set<string>((enabledRows ?? []).map((r: any) => String(r.project_id)).filter(Boolean));

  // 2) projects via organization_members
  const { data: orgMembersRows } = await admin
    .from("organization_members")
    .select("organization_id")
    .in("user_id", paidUserIdsCapped)
    .limit(5000);
  const orgIds = new Set<string>((orgMembersRows ?? []).map((r: any) => String(r.organization_id)).filter(Boolean));

  const projectsFromOrgs = new Set<string>();
  if (orgIds.size > 0) {
    const orgIdsArr = Array.from(orgIds).slice(0, 2000);
    const { data: projRows } = await admin
      .from("projects")
      .select("id")
      .in("organization_id", orgIdsArr)
      .eq("archived", false);
    for (const p of projRows ?? []) projectsFromOrgs.add(String((p as any).id));
  }

  // 3) projects via project_members
  const { data: pmRows } = await admin
    .from("project_members")
    .select("project_id")
    .in("user_id", paidUserIdsCapped)
    .limit(5000);
  const projectsFromMembers = new Set<string>((pmRows ?? []).map((r: any) => String(r.project_id)).filter(Boolean));

  const candidateProjects = new Set<string>([...projectsFromOrgs, ...projectsFromMembers]);
  // 4) intersect with enabled + not archived
  const candidateArr = Array.from(candidateProjects).slice(0, 2000);
  if (candidateArr.length === 0) return [];

  const { data: projRows2 } = await admin
    .from("projects")
    .select("id, archived")
    .in("id", candidateArr);

  const notArchived = new Set<string>((projRows2 ?? []).map((r: any) => String(r.id)).filter(Boolean));

  const final = Array.from(notArchived).filter((pid) => enabledProjects.has(pid));
  return final;
}

async function runInternalCron(): Promise<{
  success: boolean;
  date: string;
  queued: number;
  skipped: number;
  failed: { project_id: string; error: string }[];
}> {
  const admin = supabaseAdmin();
  const today = todayYmd();

  let oauthSweepRefreshedProjects: string[] = [];
  try {
    const sweep = await runOAuthTokenRefreshSweep(admin, { maxIntegrations: 80 });
    oauthSweepRefreshedProjects = sweep.refreshedProjectIds ?? [];
  } catch (e) {
    console.error("[INTERNAL_SYNC_CRON_OAUTH_REFRESH]", e);
  }

  const baseUrl = process.env.NEXT_PUBLIC_APP_URL
    ? String(process.env.NEXT_PUBLIC_APP_URL)
    : process.env.VERCEL_URL
      ? `https://${process.env.VERCEL_URL}`
      : "http://localhost:3000";

  const internalHeaders = getInternalSyncHeaders();

  if (process.env.OAUTH_REFRESH_TRIGGER_SYNC !== "0" && oauthSweepRefreshedProjects.length > 0) {
    const unique = [...new Set(oauthSweepRefreshedProjects)].slice(0, 22);
    console.log("[INTERNAL_SYNC_CRON_OAUTH_REFRESH_SYNC]", { projects: unique.length });
    for (const projectId of unique) {
      const syncUrl = new URL("/api/dashboard/sync", baseUrl);
      syncUrl.searchParams.set("project_id", projectId);
      syncUrl.searchParams.set("start", today);
      syncUrl.searchParams.set("end", today);
      syncUrl.searchParams.set("date_origin", "utc_today");
      try {
        const r = await fetch(syncUrl.toString(), { method: "POST", headers: internalHeaders });
        const json = (await r.json().catch(() => ({}))) as { success?: boolean; error?: string };
        if (!r.ok || !json?.success) {
          console.warn("[OAUTH_REFRESH_FOLLOW_SYNC_FAIL]", { projectId, error: json?.error ?? r.status });
        }
      } catch (e) {
        console.warn("[OAUTH_REFRESH_FOLLOW_SYNC_ERR]", { projectId, error: e });
      }
    }
  }

  const paidUserIds = await getPaidUserIds(admin);
  if (paidUserIds.size === 0) {
    return { success: true, date: today, queued: 0, skipped: 0, failed: [] };
  }

  const paidProjects = await getPaidActiveProjectIds(admin, paidUserIds);
  if (paidProjects.length === 0) {
    return { success: true, date: today, queued: 0, skipped: 0, failed: [] };
  }

  const MAX_PROJECTS_PER_RUN = Number(process.env.INTERNAL_SYNC_CRON_MAX_PROJECTS ?? 50);
  const projectIds = paidProjects.slice(0, MAX_PROJECTS_PER_RUN);

  console.log("[INTERNAL_SYNC_CRON_SELECTION]", {
    date: today,
    paid_users: paidUserIds.size,
    paid_projects: paidProjects.length,
    queued_limit: MAX_PROJECTS_PER_RUN,
    using_projects: projectIds.length,
  });

  const lockWindowMs = 3 * 60 * 60 * 1000; // aligns with cron cadence
  const failed: { project_id: string; error: string }[] = [];

  let queued = 0;
  let skipped = 0;

  console.log("[INTERNAL_SYNC_CRON_START]", { date: today, projectIds: projectIds.length });
  for (const projectId of projectIds) {
    const lockKey = `internal-sync-cron:project:${projectId}`;
    const rl = await checkRateLimit(lockKey, 1, lockWindowMs);
    if (!rl.ok) {
      skipped += 1;
      continue;
    }

    const syncUrl = new URL("/api/dashboard/sync", baseUrl);
    syncUrl.searchParams.set("project_id", projectId);
    syncUrl.searchParams.set("start", today);
    syncUrl.searchParams.set("end", today);
    syncUrl.searchParams.set("date_origin", "utc_today");

    try {
      const r = await fetch(syncUrl.toString(), {
        method: "POST",
        headers: internalHeaders,
      });
      const json = (await r.json().catch(() => ({}))) as any;
      if (!r.ok || !json?.success) {
        failed.push({ project_id: projectId, error: json?.error ?? `HTTP ${r.status}` });
      } else {
        queued += 1;
        if (Array.isArray(json?.warnings) && json.warnings.length > 0) {
          console.log("[INTERNAL_SYNC_CRON_PROJECT_WARNINGS]", {
            project_id: projectId,
            warnings: json.warnings.length,
          });
        }
      }
    } catch (e: any) {
      failed.push({ project_id: projectId, error: e instanceof Error ? e.message : String(e) });
    }
  }

  console.log("[INTERNAL_SYNC_CRON_DONE]", {
    date: today,
    queued,
    skipped,
    failed: failed.length,
  });

  return { success: true, date: today, queued, skipped, failed };
}

export async function GET(req: Request) {
  const ok = await authorizeInternalCron(req);
  if (!ok) return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 });
  const result = await runInternalCron();
  return NextResponse.json(result);
}

export async function POST(req: Request) {
  const ok = await authorizeInternalCron(req);
  if (!ok) return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 });
  const result = await runInternalCron();
  return NextResponse.json(result);
}

