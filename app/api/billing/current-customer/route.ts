import { NextResponse } from "next/server";
import { createServerSupabase } from "@/app/lib/supabaseServer";
import { supabaseAdmin } from "@/app/lib/supabaseAdmin";

export async function GET() {
  const supabase = await createServerSupabase();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 });
  }

  const admin = supabaseAdmin();
  const email = (user.email ?? "").trim().toLowerCase();

  const ids = new Set<string>();
  const { data: byUser } = await admin
    .from("billing_customer_map")
    .select("provider_customer_id")
    .eq("provider", "paddle")
    .eq("user_id", user.id)
    .order("updated_at", { ascending: false })
    .limit(5);
  for (const r of byUser ?? []) {
    if (r.provider_customer_id) ids.add(String(r.provider_customer_id));
  }

  if (ids.size === 0 && email) {
    const { data: byEmail } = await admin
      .from("billing_customer_map")
      .select("provider_customer_id")
      .eq("provider", "paddle")
      .eq("email", email)
      .order("updated_at", { ascending: false })
      .limit(5);
    for (const r of byEmail ?? []) {
      if (r.provider_customer_id) ids.add(String(r.provider_customer_id));
    }
  }

  const customerId = Array.from(ids).find((id) => id.startsWith("ctm_")) ?? null;
  return NextResponse.json({ success: true, customer_id: customerId });
}

