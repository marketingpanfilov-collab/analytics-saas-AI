import { NextResponse } from "next/server";
import { createServerSupabase } from "@/app/lib/supabaseServer";
import { getCurrentSystemRoleCheck } from "@/app/lib/auth/systemRoles";
import { supabaseAdmin } from "@/app/lib/supabaseAdmin";
import { checkRateLimit, getRequestIp } from "@/app/lib/security/rateLimit";

export async function POST(req: Request) {
  try {
    const internalSecret = process.env.INTERNAL_SYNC_SECRET?.trim();
    const receivedSecret = req.headers.get("x-internal-sync-secret")?.trim() ?? "";
    const bySecret = !!internalSecret && receivedSecret === internalSecret;

    const supabase = await createServerSupabase();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    const byAuth = !!user;
    const sys = await getCurrentSystemRoleCheck(["service_admin"]);
    const bySystemRole = sys.hasAnyAllowedRole;
    if (!bySecret && !byAuth && !bySystemRole) {
      return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 });
    }

    const ip = getRequestIp(req);
    const rlKey = byAuth && user?.id ? `rates:update:${user.id}:${ip}` : `rates:update:anon:${ip}`;
    const rl = await checkRateLimit(rlKey, 15, 60_000);
    if (!rl.ok) {
      return NextResponse.json(
        { success: false, error: `Rate limit exceeded. Retry in ${rl.retryAfterSec}s` },
        { status: 429 }
      );
    }

    const currencyApiKey = process.env.CURRENCYAPI_KEY?.trim();
    if (!currencyApiKey) {
      return NextResponse.json(
        { success: false, error: "CURRENCYAPI_KEY is not configured" },
        { status: 500 }
      );
    }

    const url = `https://api.currencyapi.com/v3/latest?apikey=${encodeURIComponent(
      currencyApiKey
    )}&base_currency=USD&currencies=KZT`;

    const res = await fetch(url);
    if (!res.ok) {
      const text = await res.text();
      return NextResponse.json(
        { success: false, error: `currencyapi.com error: ${res.status} ${text}` },
        { status: 502 }
      );
    }

    const json = (await res.json()) as any;
    const rate = Number(json?.data?.KZT?.value ?? json?.data?.KZT?.rate ?? 0);
    if (!rate || !Number.isFinite(rate) || rate <= 0) {
      return NextResponse.json(
        { success: false, error: "Invalid KZT rate in response" },
        { status: 500 }
      );
    }

    const admin = supabaseAdmin();
    const { error } = await admin
      .from("exchange_rates")
      .upsert(
        {
          base_currency: "USD",
          quote_currency: "KZT",
          rate,
          updated_at: new Date().toISOString(),
        },
        { onConflict: "base_currency,quote_currency" }
      );

    if (error) {
      return NextResponse.json({ success: false, error: error.message }, { status: 500 });
    }

    return NextResponse.json({ success: true, base: "USD", quote: "KZT", rate });
  } catch (err) {
    return NextResponse.json(
      { success: false, error: err instanceof Error ? err.message : "Unknown error" },
      { status: 500 }
    );
  }
}

