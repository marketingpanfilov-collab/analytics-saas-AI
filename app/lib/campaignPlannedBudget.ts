/**
 * Planned platform budget for a calendar month from synced campaign rows (daily vs lifetime + stop date).
 * Amounts are in the same numeric scale as stored on campaigns (major currency units).
 */

export type CampaignBudgetInput = {
  budget_type: "daily" | "lifetime" | null;
  daily_budget: number | null;
  lifetime_budget: number | null;
  campaign_start_time: string | null;
  campaign_stop_time: string | null;
};

function ymdUtc(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function parseDay(ymd: string): Date {
  const [y, m, d] = ymd.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d));
}

function minYmd(a: string, b: string): string {
  return a <= b ? a : b;
}

function maxYmd(a: string, b: string): string {
  return a >= b ? a : b;
}

function daysInclusive(startYmd: string, endYmd: string): number {
  const t0 = parseDay(startYmd).getTime();
  const t1 = parseDay(endYmd).getTime();
  if (t1 < t0) return 0;
  return Math.floor((t1 - t0) / 86400000) + 1;
}

function lastDayOfMonthUtc(year: number, month1to12: number): string {
  const last = new Date(Date.UTC(year, month1to12, 0));
  return ymdUtc(last);
}

/**
 * Intersection of [monthStart, monthEnd] with [campaignStart, campaignStop] (open-ended if stop null).
 */
export function plannedBudgetForCampaignInMonth(
  c: CampaignBudgetInput,
  year: number,
  month: number
): number {
  const monthStart = `${year}-${String(month).padStart(2, "0")}-01`;
  const monthEnd = lastDayOfMonthUtc(year, month);

  let effStart = monthStart;
  let effEnd = monthEnd;

  if (c.campaign_start_time) {
    const cs = ymdUtc(new Date(c.campaign_start_time));
    effStart = maxYmd(effStart, cs);
  }
  if (c.campaign_stop_time) {
    const ce = ymdUtc(new Date(c.campaign_stop_time));
    effEnd = minYmd(effEnd, ce);
  }

  if (effEnd < effStart) return 0;

  const activeDays = daysInclusive(effStart, effEnd);
  if (activeDays <= 0) return 0;

  if (c.budget_type === "daily") {
    const d = Number(c.daily_budget ?? 0);
    if (!Number.isFinite(d) || d <= 0) return 0;
    return d * activeDays;
  }

  if (c.budget_type === "lifetime") {
    const L = Number(c.lifetime_budget ?? 0);
    if (!Number.isFinite(L) || L <= 0) return 0;
    let campaignSpanDays = activeDays;
    if (c.campaign_start_time && c.campaign_stop_time) {
      const cs = ymdUtc(new Date(c.campaign_start_time));
      const ce = ymdUtc(new Date(c.campaign_stop_time));
      campaignSpanDays = Math.max(1, daysInclusive(cs, ce));
    } else if (c.campaign_start_time && !c.campaign_stop_time) {
      const cs = ymdUtc(new Date(c.campaign_start_time));
      campaignSpanDays = Math.max(1, daysInclusive(cs, monthEnd));
    } else if (!c.campaign_start_time && c.campaign_stop_time) {
      const ce = ymdUtc(new Date(c.campaign_stop_time));
      campaignSpanDays = Math.max(1, daysInclusive(monthStart, ce));
    }
    const share = activeDays / campaignSpanDays;
    return L * Math.min(1, Math.max(0, share));
  }

  return 0;
}

export function sumPlannedBudgetForMonth(campaigns: CampaignBudgetInput[], year: number, month: number): number {
  let s = 0;
  for (const c of campaigns) {
    s += plannedBudgetForCampaignInMonth(c, year, month);
  }
  return s;
}
