import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/app/lib/supabaseAdmin";
import { requireProjectAccessOrInternal } from "@/app/lib/auth/requireProjectAccessOrInternal";

type SourceOption = {
  id: string;
  type: "platform" | "class";
  label: string;
};

function toISODate(s: string | null) {
  if (!s) return null;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return null;
  return s;
}

const PLATFORM_LABELS: Record<string, string> = {
  meta: "Meta Ads",
  google: "Google Ads",
  tiktok: "TikTok Ads",
  yandex: "Yandex Ads",
};

const CLASS_LABELS: Record<string, string> = {
  direct: "Direct",
  organic_search: "Organic Search",
  referral: "Referral",
};

const PLATFORM_SOURCE_VALUES = ["meta", "google", "tiktok", "yandex"] as const;

function normalizePlatformSource(raw: string | null): string | null {
  const v = (raw ?? "").trim().toLowerCase();
  if (!v) return null;
  return PLATFORM_SOURCE_VALUES.includes(v as (typeof PLATFORM_SOURCE_VALUES)[number]) ? v : null;
}

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const projectId = searchParams.get("project_id")?.trim() ?? "";
  const start = toISODate(searchParams.get("start"));
  const end = toISODate(searchParams.get("end"));

  if (!projectId) {
    return NextResponse.json({ success: false, error: "project_id required" }, { status: 400 });
  }
  if (!start || !end) {
    return NextResponse.json(
      { success: false, error: "start and end are required (YYYY-MM-DD)" },
      { status: 400 }
    );
  }

  const access = await requireProjectAccessOrInternal(req, projectId);
  if (!access.allowed) {
    console.log("[SOURCE_OPTIONS_ACCESS_DENIED]", { projectId, status: access.status });
    return NextResponse.json(access.body, { status: access.status });
  }

  const admin = supabaseAdmin();
  const from = `${start}T00:00:00.000Z`;
  const to = `${end}T23:59:59.999Z`;

  try {
    const options: SourceOption[] = [];

    // 1) Platform sources from enabled ad accounts (same project-level logic as /dashboard/accounts).
    const { data: integrationsMetaRows } = await admin
      .from("integrations_meta")
      .select("integrations_id")
      .eq("project_id", projectId);
    const metaIds = (integrationsMetaRows ?? [])
      .map((r: { integrations_id: string | null }) => r.integrations_id)
      .filter(Boolean) as string[];

    const { data: googleIntRows } = await admin
      .from("integrations")
      .select("id")
      .eq("project_id", projectId)
      .eq("platform", "google");
    const googleIds = (googleIntRows ?? []).map((r: { id: string }) => r.id);

    const integrationIds = [...new Set([...metaIds, ...googleIds])];

    if (integrationIds.length > 0) {
      const { data: adAccounts } = await admin
        .from("ad_accounts")
        .select("id, provider, external_account_id")
        .in("integration_id", integrationIds);

      const accounts = (adAccounts ?? []) as {
        id: string;
        provider: string;
        external_account_id: string;
      }[];

      const ids = accounts.map((a) => a.id);
      const enabledAdAccountIds = new Set<string>();

      if (ids.length > 0) {
        const { data: settingsRows } = await admin
          .from("ad_account_settings")
          .select("ad_account_id")
          .eq("project_id", projectId)
          .eq("is_enabled", true)
          .in("ad_account_id", ids);

        for (const r of (settingsRows ?? []) as { ad_account_id: string }[]) {
          enabledAdAccountIds.add(r.ad_account_id);
        }
      }

      // Fallback for legacy Meta accounts when ad_account_settings is empty.
      let metaEnabledExternalIds = new Set<string>();
      if (enabledAdAccountIds.size === 0) {
        const { data: metaEnabledRows } = await admin
          .from("meta_ad_accounts")
          .select("ad_account_id")
          .eq("project_id", projectId)
          .eq("is_enabled", true);
        metaEnabledExternalIds = new Set(
          (metaEnabledRows ?? []).map((r: { ad_account_id: string }) => r.ad_account_id)
        );
      }

      const enabledPlatforms = new Set<string>();
      for (const a of accounts) {
        const isEnabled =
          enabledAdAccountIds.size > 0
            ? enabledAdAccountIds.has(a.id)
            : a.provider === "meta"
              ? metaEnabledExternalIds.has(a.external_account_id)
              : false;

        if (isEnabled && a.provider) {
          enabledPlatforms.add(a.provider);
        }
      }

      for (const p of enabledPlatforms) {
        options.push({
          id: p,
          type: "platform",
          label: PLATFORM_LABELS[p] ?? p,
        });
      }
    }

    // 2) Source classes from visit_source_events.source_classification
    const { data: visitRows, error: visitError } = await admin
      .from("visit_source_events")
      .select("source_classification")
      .eq("site_id", projectId)
      .gte("created_at", from)
      .lte("created_at", to);

    if (visitError) {
      console.warn("[DASHBOARD_SOURCE_OPTIONS_VISITS_ERROR]", visitError);
    } else {
      const classSet = new Set<string>();
      for (const row of visitRows ?? []) {
        const cls = String((row as { source_classification: string | null }).source_classification || "").trim();
        if (!cls) continue;
        // Only surface classes that are meaningful for the dashboard.
        if (cls === "direct" || cls === "organic_search" || cls === "referral") {
          classSet.add(cls);
        }
      }

      // 3) Fallback: ensure classes used by KPI logic (including synthetic "direct")
      // are also represented here, even if visit_source_events rows are missing.
      type ConversionRow = {
        event_name: string;
        source: string | null;
        traffic_source: string | null;
        visitor_id: string | null;
        created_at: string;
      };

      const { data: convData, error: convError } = await admin
        .from("conversion_events")
        .select("event_name, source, traffic_source, visitor_id, created_at")
        .eq("project_id", projectId)
        .gte("created_at", from)
        .lte("created_at", to)
        .in("event_name", ["registration", "purchase"]);

      if (convError) {
        console.warn("[DASHBOARD_SOURCE_OPTIONS_CONVERSIONS_ERROR]", convError);
      } else {
        const convRows = (convData ?? []) as ConversionRow[];

        const visitorIds = Array.from(
          new Set(convRows.map((r) => r.visitor_id).filter((v): v is string => !!v))
        );

        type VisitRow = {
          visitor_id: string | null;
          source_classification: string | null;
          created_at: string;
        };

        const visitsByVisitor = new Map<string, VisitRow[]>();
        if (visitorIds.length > 0) {
          const { data: visitDataForConv, error: visitErrorForConv } = await admin
            .from("visit_source_events")
            .select("visitor_id, source_classification, created_at")
            .eq("site_id", projectId)
            .in("visitor_id", visitorIds)
            .gte("created_at", from)
            .lte("created_at", to);

          if (visitErrorForConv) {
            console.warn("[DASHBOARD_SOURCE_OPTIONS_VISITS_FOR_CONV_ERROR]", visitErrorForConv);
          } else {
            for (const v of (visitDataForConv ?? []) as VisitRow[]) {
              if (!v.visitor_id) continue;
              const list = visitsByVisitor.get(v.visitor_id) ?? [];
              list.push(v);
              visitsByVisitor.set(v.visitor_id, list);
            }
            for (const [key, list] of visitsByVisitor.entries()) {
              list.sort((a, b) =>
                a.created_at < b.created_at ? -1 : a.created_at > b.created_at ? 1 : 0
              );
              visitsByVisitor.set(key, list);
            }
          }
        }

        for (const r of convRows) {
          const platformSource =
            normalizePlatformSource(r.traffic_source) ?? normalizePlatformSource(r.source);

          let sourceClass: string | null = null;
          if (r.visitor_id) {
            const visits = visitsByVisitor.get(r.visitor_id) ?? [];
            if (visits.length) {
              const convTs = r.created_at;
              let chosen: VisitRow | null = null;
              for (const v of visits) {
                if (v.created_at <= convTs) {
                  chosen = v;
                } else {
                  break;
                }
              }
              sourceClass =
                (chosen?.source_classification ?? null)?.trim().toLowerCase() || null;
            }
          }

          // Direct rule: if we have no detected source (platform or class), treat as direct.
          if (!sourceClass && !platformSource) {
            sourceClass = "direct";
          }

          if (
            sourceClass === "direct" ||
            sourceClass === "organic_search" ||
            sourceClass === "referral"
          ) {
            classSet.add(sourceClass);
          }
        }
      }

      for (const cls of classSet) {
        options.push({
          id: cls,
          type: "class",
          label: CLASS_LABELS[cls] ?? cls,
        });
      }
    }

    // Sort options: platforms first (stable order), then classes alphabetically.
    const sorted = [
      ...options.filter((o) => o.type === "platform").sort((a, b) => a.label.localeCompare(b.label)),
      ...options.filter((o) => o.type === "class").sort((a, b) => a.label.localeCompare(b.label)),
    ];

    return NextResponse.json({ success: true, options: sorted });
  } catch (e: any) {
    console.error("[DASHBOARD_SOURCE_OPTIONS_FATAL]", e);
    return NextResponse.json(
      { success: false, error: e instanceof Error ? e.message : "Internal error" },
      { status: 500 }
    );
  }
}

