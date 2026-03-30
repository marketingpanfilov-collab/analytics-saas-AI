import { NextResponse } from "next/server";
import { createServerSupabase } from "@/app/lib/supabaseServer";
import { supabaseAdmin } from "@/app/lib/supabaseAdmin";
import { requireProjectAccess } from "@/app/lib/auth/requireProjectAccess";

/**
 * GET ?project_id= — последний USD→KZT из `exchange_rates` (для экрана настроек).
 */
export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const projectId = searchParams.get("project_id")?.trim();
  if (!projectId) {
    return NextResponse.json({ success: false, error: "project_id required" }, { status: 400 });
  }

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
  const { data, error } = await admin
    .from("exchange_rates")
    .select("rate, rate_date, updated_at")
    .eq("base_currency", "USD")
    .eq("quote_currency", "KZT")
    .order("rate_date", { ascending: false })
    .order("updated_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) {
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }

  const row = data as { rate?: number | null; rate_date?: string | null; updated_at?: string | null } | null;
  const rate = Number(row?.rate ?? 0);
  if (!row || !Number.isFinite(rate) || rate <= 0) {
    return NextResponse.json({
      success: true,
      rate: null,
      rate_date: null,
      updated_at: null,
      message: "Курс USD→KZT ещё не загружен в систему.",
    });
  }

  return NextResponse.json({
    success: true,
    rate,
    rate_date: row.rate_date ?? null,
    updated_at: row.updated_at ?? null,
  });
}
