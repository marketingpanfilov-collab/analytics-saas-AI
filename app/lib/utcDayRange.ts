export function utcDayRange(dateYmd: string): { startIso: string; endIso: string } | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateYmd)) return null;
  const [yStr, mStr, dStr] = dateYmd.split("-");
  const y = Number(yStr);
  const m = Number(mStr);
  const d = Number(dStr);
  if (!Number.isFinite(y) || !Number.isFinite(m) || !Number.isFinite(d)) return null;
  const start = new Date(Date.UTC(y, m - 1, d, 0, 0, 0, 0));
  const end = new Date(Date.UTC(y, m - 1, d + 1, 0, 0, 0, 0));
  return { startIso: start.toISOString(), endIso: end.toISOString() };
}

export function utcDateRangeBounds(startYmd: string, endYmd: string): { from: string; toExclusive: string } | null {
  const start = utcDayRange(startYmd);
  const end = utcDayRange(endYmd);
  if (!start || !end) return null;
  return { from: start.startIso, toExclusive: end.endIso };
}

