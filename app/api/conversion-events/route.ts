import { NextResponse } from "next/server";
import { createServerSupabase } from "@/app/lib/supabaseServer";
import { supabaseAdmin } from "@/app/lib/supabaseAdmin";
import { requireProjectAccess } from "@/app/lib/auth/requireProjectAccess";
import { utcDayRange } from "@/app/lib/utcDayRange";

const ALLOWED_EVENTS = ["registration", "purchase"] as const;

export async function GET(req: Request) {
  const url = new URL(req.url);
  const projectId = url.searchParams.get("project_id")?.trim() ?? "";
  const eventName = url.searchParams.get("event_name")?.trim() ?? "";
  const dateFilter = url.searchParams.get("date")?.trim() ?? "";
  const pageRaw = url.searchParams.get("page") ?? "1";
  const pageSizeRaw = url.searchParams.get("page_size") ?? "25";
  const search = url.searchParams.get("search")?.trim() ?? "";

  const page = Math.max(1, Number.isFinite(Number(pageRaw)) ? parseInt(pageRaw, 10) || 1 : 1);
  const requestedSize = Number.isFinite(Number(pageSizeRaw)) ? parseInt(pageSizeRaw, 10) || 25 : 25;
  const pageSize = [25, 50, 100].includes(requestedSize) ? requestedSize : 25;

  if (!projectId) {
    return NextResponse.json({ success: false, error: "project_id required" }, { status: 400 });
  }
  if (!eventName || !ALLOWED_EVENTS.includes(eventName as (typeof ALLOWED_EVENTS)[number])) {
    return NextResponse.json(
      { success: false, error: "event_name must be registration or purchase" },
      { status: 400 }
    );
  }

  try {
    const supabase = await createServerSupabase();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 });
    }

    const access = await requireProjectAccess(user.id, projectId);
    if (!access) {
      return NextResponse.json({ success: false, error: "Project access denied" }, { status: 403 });
    }

    const admin = supabaseAdmin();
    const from = (page - 1) * pageSize;
    const to = from + pageSize - 1;

    // Optional day filter (used e.g. for sidebar \"Сегодня → Продажи → Факт\").
    // When not provided, behaviour stays the same (all events for project_id + event_name).
    let dayStartIso: string | null = null;
    let dayEndIso: string | null = null;
    if (dateFilter) {
      const range = utcDayRange(dateFilter);
      dayStartIso = range?.startIso ?? null;
      dayEndIso = range?.endIso ?? null;
    }

    let query = admin
      .from("conversion_events")
      .select(
        "id, event_time, created_at, event_name, external_event_id, user_external_id, value, currency, source, utm_source, utm_medium, utm_campaign, utm_content, utm_term, visitor_id, click_id, metadata",
        { count: "exact" }
      )
      .eq("project_id", projectId)
      .eq("event_name", eventName)
      .order("event_time", { ascending: false })
      .range(from, to);

    if (dayStartIso && dayEndIso) {
      query = query.gte("event_time", dayStartIso).lt("event_time", dayEndIso);
    }

    if (search) {
      const pattern = `%${search}%`;
      query = query.or(
        [
          `user_external_id.ilike.${pattern}`,
          `external_event_id.ilike.${pattern}`,
          `metadata->>email.ilike.${pattern}`,
        ].join(",")
      );
    }

    const { data, error, count } = await query;
    if (error) {
      console.error("[CONVERSION_EVENTS_LIST_ERROR]", error);
      return NextResponse.json({ success: false, error: error.message }, { status: 500 });
    }

    type ConversionEventRow = {
      id: string;
      event_time: string | null;
      created_at: string;
      event_name: string;
      external_event_id: string | null;
      user_external_id: string | null;
      value: number | null;
      currency: string | null;
      source: string | null;
      utm_source: string | null;
      utm_medium: string | null;
      utm_campaign: string | null;
      utm_content: string | null;
      utm_term: string | null;
      visitor_id: string | null;
      click_id: string | null;
      metadata: Record<string, unknown> | null;
    };

    const items =
      ((data ?? []) as ConversionEventRow[]).map((row) => {
        const meta = row.metadata || {};
        const email = typeof meta === "object" && meta ? (meta.email as string | undefined) ?? null : null;
        const phone = typeof meta === "object" && meta ? (meta.phone as string | undefined) ?? null : null;
        return {
          id: row.id,
          event_time: row.event_time ?? row.created_at,
          created_at: row.created_at,
          event_name: row.event_name,
          external_event_id: row.external_event_id ?? null,
          user_external_id: row.user_external_id ?? null,
          value: row.value != null ? Number(row.value) : null,
          currency: row.currency ?? null,
          source: row.source ?? null,
          utm_source: row.utm_source ?? null,
          utm_medium: row.utm_medium ?? null,
          utm_campaign: row.utm_campaign ?? null,
          utm_content: row.utm_content ?? null,
          utm_term: row.utm_term ?? null,
          visitor_id: row.visitor_id ?? null,
          click_id: row.click_id ?? null,
          metadata: row.metadata ?? null,
          email,
          phone,
        };
      }) ?? [];

    return NextResponse.json({
      success: true,
      items,
      total: count ?? 0,
      page,
      page_size: pageSize,
      event_name: eventName,
    });
  } catch (e) {
    console.error("[CONVERSION_EVENTS_LIST_FATAL]", e);
    return NextResponse.json({ success: false, error: "Internal error" }, { status: 500 });
  }
}

