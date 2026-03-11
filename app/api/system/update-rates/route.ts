import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/app/lib/supabaseAdmin";

const CURRENCY_API_KEY = process.env.CURRENCYAPI_KEY || "cur_live_8p2RcOFrFbWPD7lZKD1ZBhZPvkVZtX1uOD30pmYl";

export async function POST() {
  try {
    const url = `https://api.currencyapi.com/v3/latest?apikey=${encodeURIComponent(
      CURRENCY_API_KEY
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

