import { NextResponse } from "next/server";

function isUuid(v: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    v
  );
}

function isMetaActId(v: string) {
  return /^act_\d+$/i.test(v);
}

function isGoogleCustomerId(v: string) {
  return /^\d+(-?\d*)$/.test(String(v).trim());
}

/** Forward browser session to delegated route handlers (server-side fetch does not inherit cookies). */
function forwardAuthHeaders(req: Request): HeadersInit {
  const h: Record<string, string> = {};
  const cookie = req.headers.get("cookie");
  if (cookie) h.cookie = cookie;
  const auth = req.headers.get("authorization");
  if (auth) h.authorization = auth;
  return h;
}

/**
 * POST /api/sync/run
 *
 * Platform-agnostic sync dispatcher. Validates body, dispatches by platform + sync_type,
 * returns a normalized response. Does not remove or replace existing platform-specific
 * routes (e.g. GET /api/oauth/meta/insights/sync); they remain available.
 *
 * Body: { project_id: string, platform: string, ad_account_id: string | null, sync_type: string }
 *
 * Supported: platform = "meta", sync_type = "insights" (ad_account_id required, act_*).
 */
export async function POST(req: Request) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json(
      { success: false, error: "Invalid JSON body" },
      { status: 400 }
    );
  }

  const project_id =
    typeof (body as Record<string, unknown>)?.project_id === "string"
      ? (body as Record<string, unknown>).project_id as string
      : "";
  const platform =
    typeof (body as Record<string, unknown>)?.platform === "string"
      ? (body as Record<string, unknown>).platform as string
      : "";
  const ad_account_id =
    (body as Record<string, unknown>)?.ad_account_id === null ||
    typeof (body as Record<string, unknown>)?.ad_account_id === "string"
      ? (body as Record<string, unknown>).ad_account_id as string | null
      : undefined;
  const sync_type =
    typeof (body as Record<string, unknown>)?.sync_type === "string"
      ? (body as Record<string, unknown>).sync_type as string
      : "";

  // Validation
  if (!project_id || !platform || !sync_type) {
    return NextResponse.json(
      {
        success: false,
        error: "project_id, platform, and sync_type are required",
      },
      { status: 400 }
    );
  }

  if (!isUuid(project_id)) {
    return NextResponse.json(
      { success: false, error: "project_id must be a valid UUID" },
      { status: 400 }
    );
  }

  if (platform === "meta" && sync_type === "insights") {
    if (ad_account_id === undefined || ad_account_id === null || ad_account_id === "") {
      return NextResponse.json(
        { success: false, error: "ad_account_id is required for meta/insights sync" },
        { status: 400 }
      );
    }
    if (!isMetaActId(ad_account_id)) {
      return NextResponse.json(
        { success: false, error: "ad_account_id must look like act_123... for Meta" },
        { status: 400 }
      );
    }
  }

  if (platform === "google" && sync_type === "insights") {
    if (ad_account_id === undefined || ad_account_id === null || ad_account_id === "") {
      return NextResponse.json(
        { success: false, error: "ad_account_id is required for google/insights sync" },
        { status: 400 }
      );
    }
    if (!isGoogleCustomerId(ad_account_id)) {
      return NextResponse.json(
        { success: false, error: "ad_account_id must be a Google Ads customer id (numeric) for Google" },
        { status: 400 }
      );
    }
  }

  // Dispatch: meta + insights → delegate to existing GET Meta insights sync
  if (platform === "meta" && sync_type === "insights") {
    const baseUrl = new URL(req.url).origin;
    const url = new URL("/api/oauth/meta/insights/sync", baseUrl);
    url.searchParams.set("project_id", project_id);
    url.searchParams.set("ad_account_id", ad_account_id as string);

    const res = await fetch(url.toString(), { method: "GET", headers: forwardAuthHeaders(req) });
    const json = await res.json().catch(() => ({}));

    const success = res.ok && json?.success === true;
    const rows_written =
      success &&
      (Number(json?.saved) >= 0 ||
        Number(json?.meta_rows) >= 0 ||
        Number(json?.saved_campaign_rows) >= 0)
        ? Number(json?.saved ?? json?.meta_rows ?? (Number(json?.saved_campaign_rows ?? 0) + Number(json?.meta_account_rows ?? 0)))
        : undefined;
    const period =
      json?.period && typeof json.period === "object"
        ? { since: json.period.since ?? null, until: json.period.until ?? null }
        : undefined;
    const error =
      success ? undefined : (json?.error ?? json?.meta_error?.message ?? json?.step ?? "Sync failed");

    const normalized = {
      success,
      platform: "meta" as const,
      sync_type: "insights" as const,
      ad_account_id: ad_account_id as string,
      rows_written,
      period,
      error: error ?? null,
      details: success
        ? {
            pages: json?.pages,
            meta_account_rows: json?.meta_account_rows,
            saved_campaign_rows: json?.saved_campaign_rows,
            meta_campaign_rows: json?.meta_campaign_rows,
          }
        : {
            step: json?.step,
            meta_error: json?.meta_error,
          },
    };

    return NextResponse.json(normalized, {
      status: success ? 200 : (res.status >= 400 ? res.status : 500),
    });
  }

  if (platform === "google" && sync_type === "insights") {
    const baseUrl = new URL(req.url).origin;
    const url = new URL("/api/oauth/google/insights/sync", baseUrl);
    url.searchParams.set("project_id", project_id);
    url.searchParams.set("ad_account_id", ad_account_id as string);

    const res = await fetch(url.toString(), { method: "GET", headers: forwardAuthHeaders(req) });
    const json = await res.json().catch(() => ({}));

    const success = res.ok && json?.success === true;
    const rows_written = success ? Number(json?.saved ?? 0) : undefined;
    const period =
      json?.period && typeof json.period === "object"
        ? { since: json.period.since ?? null, until: json.period.until ?? null }
        : undefined;
    const error = success ? undefined : (json?.error ?? json?.step ?? "Sync failed");

    const normalized = {
      success,
      platform: "google" as const,
      sync_type: "insights" as const,
      ad_account_id: ad_account_id as string,
      rows_written,
      period,
      error: error ?? null,
      details: success ? { saved: json?.saved } : { step: json?.step },
    };

    return NextResponse.json(normalized, {
      status: success ? 200 : (res.status >= 400 ? res.status : 500),
    });
  }

  return NextResponse.json(
    {
      success: false,
      error: `Unsupported platform/sync_type: ${platform}/${sync_type}`,
      platform,
      sync_type,
    },
    { status: 400 }
  );
}
