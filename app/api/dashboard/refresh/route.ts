import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/app/lib/supabaseAdmin";

function normalizeActId(raw: string | null | undefined) {
  if (!raw) return null;
  const s = String(raw).trim();
  if (/^act_\d+$/.test(s)) return s;
  if (/^\d+$/.test(s)) return `act_${s}`;
  return null;
}

async function pickAdAccountFromGraph(accessToken: string) {
  const url = new URL("https://graph.facebook.com/v19.0/me/adaccounts");
  url.searchParams.set("fields", "id,account_id,name,account_status,currency,timezone_name");
  url.searchParams.set("limit", "50");
  url.searchParams.set("access_token", accessToken);

  const r = await fetch(url.toString(), { method: "GET" });
  const j = await r.json();

  if (!r.ok) throw new Error(j?.error?.message || "Failed to fetch /me/adaccounts");

  const list = Array.isArray(j?.data) ? j.data : [];
  if (!list.length) throw new Error("No ad accounts available for this token");

  // ✅ лучше брать активный (account_status == 1), иначе можно “поймать” странный аккаунт
  const active = list.find((x: any) => Number(x?.account_status) === 1) ?? list[0];

  const actId = normalizeActId(active?.id) || normalizeActId(active?.account_id);
  if (!actId) throw new Error("Could not determine act_* id from Graph response");

  return actId;
}

export async function POST(req: Request) {
  try {
    const body = await req.json();

    const project_id = body.project_id;
    const start = body.start;
    const end = body.end;

    if (!project_id || !start || !end) {
      return NextResponse.json(
        { success: false, error: "project_id, start, end required" },
        { status: 400 }
      );
    }

    const admin = supabaseAdmin();
    const baseUrl = new URL(req.url).origin;
    const results: { meta?: unknown; google?: { ad_account_id: string }[] } = {};
    let ad_account_id: string | null = null;

    // Meta: sync for range if integration exists
    const { data: metaData, error: metaErr } = await admin
      .from("integrations_meta")
      .select("account_id, access_token, token_source, created_at")
      .eq("project_id", project_id)
      .eq("token_source", "oauth_meta")
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (!metaErr && metaData?.access_token) {
      const accessToken = metaData.access_token as string;
      let account_id = normalizeActId(metaData.account_id);
      if (!account_id) {
        account_id = await pickAdAccountFromGraph(accessToken);
        await admin
          .from("integrations_meta")
          .update({ account_id })
          .eq("project_id", project_id)
          .eq("token_source", "oauth_meta");
      }
      ad_account_id = account_id;

      const url = new URL("/api/oauth/meta/insights/sync", req.url);
      url.searchParams.set("project_id", project_id);
      url.searchParams.set("ad_account_id", account_id);
      url.searchParams.set("date_start", start);
      url.searchParams.set("date_stop", end);
      const r = await fetch(url.toString());
      const json = await r.json();
      if (!r.ok || json?.success === false) {
        return NextResponse.json(
          {
            success: false,
            error: json?.error || json?.message || "Meta sync failed",
            sync: json,
            ad_account_id: account_id,
          },
          { status: 500 }
        );
      }
      results.meta = json;
    }

    // Google: same date range for enabled accounts
    const { data: settingsRows } = await admin
      .from("ad_account_settings")
      .select("ad_account_id")
      .eq("project_id", project_id)
      .eq("is_enabled", true);
    const enabledIds = (settingsRows ?? []).map((row: { ad_account_id: string }) => row.ad_account_id);
    if (enabledIds.length > 0) {
      const { data: googleAccounts } = await admin
        .from("ad_accounts")
        .select("external_account_id")
        .in("id", enabledIds)
        .eq("provider", "google");
      const synced: { ad_account_id: string }[] = [];
      for (const acc of googleAccounts ?? []) {
        const externalId = (acc as { external_account_id: string | null }).external_account_id;
        if (!externalId) continue;
        const gUrl = new URL(`${baseUrl}/api/oauth/google/insights/sync`);
        gUrl.searchParams.set("project_id", project_id);
        gUrl.searchParams.set("ad_account_id", externalId);
        gUrl.searchParams.set("date_start", start);
        gUrl.searchParams.set("date_end", end);
        const gRes = await fetch(gUrl.toString());
        const gJson = await gRes.json().catch(() => ({}));
        if (!gRes.ok || gJson?.success === false) {
          return NextResponse.json(
            {
              success: false,
              error: gJson?.error ?? "Google sync failed",
              ad_account_id: externalId,
            },
            { status: 500 }
          );
        }
        synced.push({ ad_account_id: externalId });
      }
      results.google = synced;
    }

    if (!results.meta && !results.google?.length) {
      return NextResponse.json(
        { success: false, error: "No Meta or enabled Google account connected for this project" },
        { status: 404 }
      );
    }

    return NextResponse.json({
      success: true,
      refreshed_at: new Date().toISOString(),
      ad_account_id: ad_account_id ?? undefined,
      sync: results,
    });
  } catch (e: any) {
    return NextResponse.json(
      { success: false, error: e?.message || String(e) },
      { status: 500 }
    );
  }
}