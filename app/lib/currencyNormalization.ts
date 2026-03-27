import type { SupabaseClient } from "@supabase/supabase-js";

export type SupportedCurrency = "USD" | "KZT";

export type CurrencyReasonCode =
  | "ok"
  | "currency_missing"
  | "currency_unsupported"
  | "rate_missing"
  | "rate_missing_for_day"
  | "fallback_latest_rate_used"
  | "mixed_currency_input";

export type CurrencyDiagnostics = {
  reason_codes: CurrencyReasonCode[];
  warnings: string[];
  mixed_currency: boolean;
};

export function normalizeCurrencyCode(raw: string | null | undefined): SupportedCurrency | null {
  const v = String(raw ?? "").trim().toUpperCase();
  if (v === "USD" || v === "KZT") return v;
  return null;
}

export function createCurrencyDiagnostics(): CurrencyDiagnostics {
  return { reason_codes: [], warnings: [], mixed_currency: false };
}

export function pushCurrencyReason(
  diagnostics: CurrencyDiagnostics | null | undefined,
  code: CurrencyReasonCode,
  warning?: string
) {
  if (!diagnostics) return;
  if (!diagnostics.reason_codes.includes(code)) diagnostics.reason_codes.push(code);
  if (warning && !diagnostics.warnings.includes(warning)) diagnostics.warnings.push(warning);
}

export function convertMoneyStrict(
  amount: number,
  fromCurrency: SupportedCurrency,
  toCurrency: SupportedCurrency,
  usdToKztRate: number | null,
  diagnostics?: CurrencyDiagnostics
): number {
  if (!Number.isFinite(amount)) return 0;
  if (fromCurrency === toCurrency) return amount;
  if (!usdToKztRate || usdToKztRate <= 0) {
    pushCurrencyReason(diagnostics, "rate_missing", "Missing USD/KZT exchange rate; conversion skipped.");
    return amount;
  }
  return fromCurrency === "USD" && toCurrency === "KZT"
    ? amount * usdToKztRate
    : amount / usdToKztRate;
}

export async function getLatestUsdToKztRate(admin: SupabaseClient): Promise<number | null> {
  const { data, error } = await admin
    .from("exchange_rates")
    .select("rate")
    .eq("base_currency", "USD")
    .eq("quote_currency", "KZT")
    .order("rate_date", { ascending: false })
    .order("updated_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) return null;
  const rate = Number((data as { rate?: number | null } | null)?.rate ?? 0);
  return Number.isFinite(rate) && rate > 0 ? rate : null;
}

function normalizeDay(day: string | null | undefined): string | null {
  const v = String(day ?? "").trim();
  return /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : null;
}

export async function getUsdToKztRateMapForDays(
  admin: SupabaseClient,
  days: Array<string | null | undefined>
): Promise<Map<string, number>> {
  const normalizedDays = Array.from(new Set(days.map(normalizeDay).filter((v): v is string => !!v)));
  const out = new Map<string, number>();
  if (normalizedDays.length === 0) return out;

  const { data, error } = await admin
    .from("exchange_rates")
    .select("rate_date, rate")
    .eq("base_currency", "USD")
    .eq("quote_currency", "KZT")
    .in("rate_date", normalizedDays);
  if (error) return out;

  for (const row of (data ?? []) as { rate_date?: string | null; rate?: number | null }[]) {
    const day = normalizeDay(row.rate_date);
    const rate = Number(row.rate ?? 0);
    if (!day || !Number.isFinite(rate) || rate <= 0) continue;
    out.set(day, rate);
  }
  return out;
}

export function resolveUsdToKztRateForDay(
  day: string | null | undefined,
  rateMapByDay: Map<string, number>,
  latestRate: number | null,
  diagnostics?: CurrencyDiagnostics
): number | null {
  const normalizedDay = normalizeDay(day);
  if (normalizedDay) {
    const fromDay = rateMapByDay.get(normalizedDay);
    if (typeof fromDay === "number" && fromDay > 0) return fromDay;
    pushCurrencyReason(
      diagnostics,
      "rate_missing_for_day",
      `Missing USD/KZT rate for day ${normalizedDay}.`
    );
  }
  if (latestRate && latestRate > 0) {
    pushCurrencyReason(
      diagnostics,
      "fallback_latest_rate_used",
      normalizedDay
        ? `Fallback to latest USD/KZT rate for day ${normalizedDay}.`
        : "Fallback to latest USD/KZT rate."
    );
    return latestRate;
  }
  pushCurrencyReason(diagnostics, "rate_missing", "No usable USD/KZT rate found.");
  return null;
}

