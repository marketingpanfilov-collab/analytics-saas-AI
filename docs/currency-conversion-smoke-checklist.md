# Currency Conversion Smoke Checklist

## Preconditions
- Project currency switch available in settings page.
- `exchange_rates` has recent `USD -> KZT` rate.
- Test data includes purchases/metrics in both `USD` and `KZT`.

## 1) Currency switch behavior
- Change project currency `USD -> KZT` in settings.
- Verify:
  - `/api/projects/currency` succeeds.
  - `/api/system/update-rates` succeeds.
  - Page reloads automatically after successful save/rate update.
- Change back `KZT -> USD` and verify automatic reload.

## 2) Dashboard consistency
- Compare `summary`, `timeseries`, and `kpi` for same date range before/after switch.
- Verify no obvious jumps caused by double conversion.
- Verify conversions are stable for historical range (not tied to today's rate update).

## 3) LTV and Weekly report hardening
- Call `/api/ltv` and `/api/weekly-board-report` for same period.
- Verify revenue currency is coherent with project currency.
- Check logs for diagnostics:
  - `[WEEKLY_REPORT_CURRENCY_DIAGNOSTICS]`
  - warnings about `currency_missing` / `currency_unsupported`.

## 4) Legacy/null currency fallback checks
- If some events have missing `currency`, verify:
  - endpoint still responds,
  - diagnostics are present (no silent corruption).

## 5) Account currency integrity (Google/Meta/TikTok)
- Re-run account discovery flows and verify `ad_accounts.currency` is filled when provider returns it.
- Ensure dashboard normalization does not regress for existing historical rows.

## 6) Historical daily-rate behavior
- Ensure `exchange_rates` has `rate_date` and unique key per `(base_currency, quote_currency, rate_date)`.
- Trigger `/api/system/update-rates` 2+ times in one day and verify only same-day record is updated (no duplicate day rows).
- For a range with several days, confirm KPI/LTV/weekly use per-day conversion (if one day rate is changed, only that day's contribution changes).

