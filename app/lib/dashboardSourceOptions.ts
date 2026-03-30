/**
 * Source filter options for the main dashboard — same list as GET /api/dashboard/source-options.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { normalizePlatformSource } from "@/app/lib/dashboardKpiAttribution";

export type DashboardSourceOption = {
  id: string;
  type: "platform" | "class";
  label: string;
};

const PLATFORM_LABELS: Record<string, string> = {
  meta: "Meta Ads",
  google: "Google Ads",
  tiktok: "TikTok Ads",
  yandex: "Yandex Ads",
};

const CLASS_LABELS: Record<string, string> = {
  direct: "Direct",
  organic_search: "Organic Search",
  organic_social: "Organic Social",
  paid: "Paid",
  unknown: "Unknown",
  referral: "Referral",
};

export async function getDashboardSourceOptions(
  admin: SupabaseClient,
  projectId: string,
  start: string,
  end: string
): Promise<DashboardSourceOption[]> {
  const from = `${start}T00:00:00.000Z`;
  const to = `${end}T23:59:59.999Z`;
  const lookupFromDate = new Date(`${start}T00:00:00.000Z`);
  lookupFromDate.setUTCDate(lookupFromDate.getUTCDate() - 30);
  const lookupFrom = lookupFromDate.toISOString();

  const options: DashboardSourceOption[] = [];

  const { data: integrationsMetaRows } = await admin
    .from("integrations_meta")
    .select("integrations_id")
    .eq("project_id", projectId);
  const metaIds = (integrationsMetaRows ?? [])
    .map((r: { integrations_id: string | null }) => r.integrations_id)
    .filter(Boolean) as string[];

  const { data: platformIntRows } = await admin
    .from("integrations")
    .select("id")
    .eq("project_id", projectId)
    .in("platform", ["meta", "google", "tiktok", "yandex"]);
  const platformIntegrationIds = (platformIntRows ?? []).map((r: { id: string }) => r.id);

  const integrationIds = [...new Set([...metaIds, ...platformIntegrationIds])];

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

    const explicitSettingsOn = new Set<string>();
    const explicitSettingsOff = new Set<string>();
    if (ids.length > 0) {
      const { data: settingsRows } = await admin
        .from("ad_account_settings")
        .select("ad_account_id, is_enabled")
        .eq("project_id", projectId)
        .in("ad_account_id", ids);

      for (const r of (settingsRows ?? []) as { ad_account_id: string; is_enabled: boolean | null }[]) {
        if (r.is_enabled === true) explicitSettingsOn.add(r.ad_account_id);
        else if (r.is_enabled === false) explicitSettingsOff.add(r.ad_account_id);
      }
    }

    const { data: metaEnabledRows } = await admin
      .from("meta_ad_accounts")
      .select("ad_account_id")
      .eq("project_id", projectId)
      .eq("is_enabled", true);
    const metaEnabledExternalIds = new Set(
      (metaEnabledRows ?? []).map((r: { ad_account_id: string }) => r.ad_account_id)
    );

    const enabledPlatforms = new Set<string>();
    for (const a of accounts) {
      let isEnabled: boolean;
      if (explicitSettingsOff.has(a.id)) {
        isEnabled = false;
      } else if (explicitSettingsOn.has(a.id)) {
        isEnabled = true;
      } else if (a.provider === "meta") {
        isEnabled = metaEnabledExternalIds.has(a.external_account_id);
      } else {
        // Google / TikTok / Yandex: нет строки или is_enabled null — как в resolveEnabledAdAccountIdsForProject
        isEnabled = true;
      }

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
      if (
        cls === "direct" ||
        cls === "organic_search" ||
        cls === "organic_social" ||
        cls === "paid" ||
        cls === "unknown" ||
        cls === "referral"
      ) {
        classSet.add(cls);
      }
    }

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

      const visitorIds = Array.from(new Set(convRows.map((r) => r.visitor_id).filter((v): v is string => !!v)));

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
          .gte("created_at", lookupFrom)
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
            list.sort((a, b) => (a.created_at < b.created_at ? -1 : a.created_at > b.created_at ? 1 : 0));
            visitsByVisitor.set(key, list);
          }
        }
      }

      for (const r of convRows) {
        const platformSource = normalizePlatformSource(r.traffic_source) ?? normalizePlatformSource(r.source);

        let sourceClass: string | null = null;
        if (r.visitor_id) {
          const visits = visitsByVisitor.get(r.visitor_id) ?? [];
          if (visits.length) {
            const convTs = r.created_at;
            let chosen: VisitRow | null = null;
            for (const v of visits) {
              if (v.created_at <= convTs) chosen = v;
              else break;
            }
            sourceClass = (chosen?.source_classification ?? null)?.trim().toLowerCase() || null;
          }
        }

        if (!sourceClass && !platformSource) {
          sourceClass = "unknown";
        }

        if (
          sourceClass === "direct" ||
          sourceClass === "organic_search" ||
          sourceClass === "organic_social" ||
          sourceClass === "paid" ||
          sourceClass === "unknown" ||
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

  return [
    ...options.filter((o) => o.type === "platform").sort((a, b) => a.label.localeCompare(b.label)),
    ...options.filter((o) => o.type === "class").sort((a, b) => a.label.localeCompare(b.label)),
  ];
}
