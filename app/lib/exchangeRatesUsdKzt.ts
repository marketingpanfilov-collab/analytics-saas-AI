import type { SupabaseClient } from "@supabase/supabase-js";
import { getLatestUsdToKztRate, getUsdToKztRateMapForDays } from "@/app/lib/currencyNormalization";

function normalizeDay(day: string | null | undefined): string | null {
  const v = String(day ?? "").trim();
  return /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : null;
}

/**
 * Запрашивает актуальный USD→KZT у currencyapi и пишет строку на сегодня (как /api/system/update-rates).
 * Без CURRENCYAPI_KEY — только последний курс из БД.
 */
export async function fetchAndStoreLatestUsdKztRate(admin: SupabaseClient): Promise<number | null> {
  const currencyApiKey = process.env.CURRENCYAPI_KEY?.trim();
  if (!currencyApiKey) {
    return getLatestUsdToKztRate(admin);
  }
  const url = `https://api.currencyapi.com/v3/latest?apikey=${encodeURIComponent(
    currencyApiKey
  )}&base_currency=USD&currencies=KZT`;
  try {
    const res = await fetch(url);
    if (!res.ok) return getLatestUsdToKztRate(admin);
    const json = (await res.json()) as { data?: { KZT?: { value?: number; rate?: number } } };
    const rate = Number(json?.data?.KZT?.value ?? json?.data?.KZT?.rate ?? 0);
    if (!rate || !Number.isFinite(rate) || rate <= 0) return getLatestUsdToKztRate(admin);
    const rateDate = new Date().toISOString().slice(0, 10);
    const { error } = await admin.from("exchange_rates").upsert(
      {
        base_currency: "USD",
        quote_currency: "KZT",
        rate,
        rate_date: rateDate,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "base_currency,quote_currency,rate_date" }
    );
    if (error) {
      console.error("[fetchAndStoreLatestUsdKztRate]", error);
      return getLatestUsdToKztRate(admin);
    }
    return rate;
  } catch (e) {
    console.error("[fetchAndStoreLatestUsdKztRate]", e);
    return getLatestUsdToKztRate(admin);
  }
}

/**
 * Для каждой даты без строки в `exchange_rates` записывает курс (последний из БД или свежий с API).
 * Убирает необходимость показывать «Missing USD/KZT rate for day …» в UI после конвертации.
 */
export async function ensureUsdToKztRatesForDays(
  admin: SupabaseClient,
  days: Array<string | null | undefined>
): Promise<void> {
  const normalized = Array.from(new Set(days.map(normalizeDay).filter((v): v is string => !!v)));
  if (normalized.length === 0) return;

  const existing = await getUsdToKztRateMapForDays(admin, normalized);
  const missing = normalized.filter((d) => !existing.has(d) || !(existing.get(d)! > 0));
  if (missing.length === 0) return;

  let rate = await getLatestUsdToKztRate(admin);
  if (rate == null || rate <= 0) {
    rate = await fetchAndStoreLatestUsdKztRate(admin);
  }
  if (rate == null || rate <= 0) return;

  const now = new Date().toISOString();
  const rows = missing.map((rate_date) => ({
    base_currency: "USD" as const,
    quote_currency: "KZT" as const,
    rate,
    rate_date,
    updated_at: now,
  }));

  const { error } = await admin.from("exchange_rates").upsert(rows, {
    onConflict: "base_currency,quote_currency,rate_date",
  });
  if (error) console.error("[ensureUsdToKztRatesForDays]", error);
}
