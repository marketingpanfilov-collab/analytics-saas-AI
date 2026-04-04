import { NextResponse } from "next/server";
import { createServerSupabase } from "@/app/lib/supabaseServer";
import { getCurrentSystemRoleCheck } from "@/app/lib/auth/systemRoles";
import { parseBearerToken } from "@/app/lib/auth/parseBearerAuth";
import { supabaseAdmin } from "@/app/lib/supabaseAdmin";
import type { ProjectAccessCheckResult } from "@/app/lib/auth/requireProjectAccessOrInternal";
import { requireBillingHeavySyncForUser } from "@/app/lib/auth/requireBillingAccess";
import { checkRateLimit, getRequestIp } from "@/app/lib/security/rateLimit";
import { fetchAndStoreLatestUsdKztRate } from "@/app/lib/exchangeRatesUsdKzt";

async function authorizeUpdateRates(req: Request): Promise<boolean> {
  const internalSecret = process.env.INTERNAL_SYNC_SECRET?.trim() ?? "";
  const cronSecret = process.env.CRON_SECRET?.trim() ?? "";
  const receivedSecret = req.headers.get("x-internal-sync-secret")?.trim() ?? "";
  if (internalSecret && receivedSecret === internalSecret) return true;

  const bearer = parseBearerToken(req.headers.get("authorization"));
  if (cronSecret && bearer === cronSecret) return true;
  if (internalSecret && bearer === internalSecret) return true;

  const supabase = await createServerSupabase();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (user) return true;

  const sys = await getCurrentSystemRoleCheck(["service_admin"]);
  return sys.hasAnyAllowedRole;
}

async function handleUpdateRates(req: Request): Promise<NextResponse> {
  try {
    const ok = await authorizeUpdateRates(req);
    if (!ok) {
      return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 });
    }

    const supabase = await createServerSupabase();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (user) {
      const synthetic: Extract<ProjectAccessCheckResult, { allowed: true }> = {
        allowed: true,
        source: "user",
        userId: user.id,
      };
      const billing = await requireBillingHeavySyncForUser(synthetic, user.email ?? null);
      if (!billing.ok) return billing.response;
    }

    const ip = getRequestIp(req);
    const rlKey = user?.id ? `rates:update:${user.id}:${ip}` : `rates:update:anon:${ip}`;
    const rl = await checkRateLimit(rlKey, 15, 60_000);
    if (!rl.ok) {
      return NextResponse.json(
        { success: false, error: `Rate limit exceeded. Retry in ${rl.retryAfterSec}s` },
        { status: 429 }
      );
    }

    const admin = supabaseAdmin();
    const currencyApiKey = process.env.CURRENCYAPI_KEY?.trim();
    if (!currencyApiKey) {
      const { data: existingRate } = await admin
        .from("exchange_rates")
        .select("rate,updated_at,rate_date")
        .eq("base_currency", "USD")
        .eq("quote_currency", "KZT")
        .order("rate_date", { ascending: false })
        .order("updated_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      const fallbackRate = Number((existingRate as { rate?: number | null } | null)?.rate ?? 0);
      if (Number.isFinite(fallbackRate) && fallbackRate > 0) {
        return NextResponse.json({
          success: true,
          base: "USD",
          quote: "KZT",
          rate: fallbackRate,
          degraded: true,
          warning: "CURRENCYAPI_KEY missing; using latest stored exchange rate",
          updated_at: (existingRate as { updated_at?: string | null } | null)?.updated_at ?? null,
          rate_date: (existingRate as { rate_date?: string | null } | null)?.rate_date ?? null,
        });
      }
      return NextResponse.json(
        { success: false, error: "CURRENCYAPI_KEY is not configured and no stored USD/KZT rate found" },
        { status: 500 }
      );
    }

    const rate = await fetchAndStoreLatestUsdKztRate(admin);
    if (rate == null || !Number.isFinite(rate) || rate <= 0) {
      return NextResponse.json(
        { success: false, error: "Invalid KZT rate from provider or database" },
        { status: 502 }
      );
    }

    const rateDate = new Date().toISOString().slice(0, 10);
    return NextResponse.json({ success: true, base: "USD", quote: "KZT", rate, rate_date: rateDate });
  } catch (err) {
    return NextResponse.json(
      { success: false, error: err instanceof Error ? err.message : "Unknown error" },
      { status: 500 }
    );
  }
}

/** Vercel Cron invokes GET for paths in `vercel.json`. */
export async function GET(req: Request) {
  return handleUpdateRates(req);
}

export async function POST(req: Request) {
  return handleUpdateRates(req);
}
