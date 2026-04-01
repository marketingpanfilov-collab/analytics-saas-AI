import { describe, expect, it } from "vitest";
import {
  aggregateCanonicalMetricRowsToSummaryResult,
  aggregateCanonicalMetricRowsToTimeseriesPoints,
  canonicalMetricRowsServerCacheKey,
  type CanonicalMetricRow,
} from "@/app/lib/dashboardCanonical";

describe("canonical aggregates parity", () => {
  it("summary totals match sums of timeseries points", () => {
    const rows: CanonicalMetricRow[] = [
      {
        date: "2024-01-01",
        platform: "meta",
        spend: 10,
        impressions: 100,
        clicks: 5,
        leads: 0,
        purchases: 1,
        revenue: 20,
      },
      {
        date: "2024-01-01",
        platform: "google",
        spend: 5,
        impressions: 50,
        clicks: 2,
        leads: 1,
        purchases: 0,
        revenue: 0,
      },
      {
        date: "2024-01-02",
        platform: "meta",
        spend: 3,
        impressions: 30,
        clicks: 1,
        leads: 0,
        purchases: 0,
        revenue: 0,
      },
    ];
    const summary = aggregateCanonicalMetricRowsToSummaryResult(rows);
    const ts = aggregateCanonicalMetricRowsToTimeseriesPoints(rows);
    expect(summary).not.toBeNull();
    expect(ts).not.toBeNull();
    const totalSpendFromTs = ts!.reduce((s, p) => s + p.spend, 0);
    expect(totalSpendFromTs).toBe(summary!.data.spend);
    const totalRevenueFromTs = ts!.reduce((s, p) => s + p.revenue, 0);
    expect(totalRevenueFromTs).toBe(summary!.data.revenue);
    expect(ts!.reduce((s, p) => s + p.clicks, 0)).toBe(summary!.data.clicks);
    expect(ts!.reduce((s, p) => s + p.purchases, 0)).toBe(summary!.data.purchases);
  });

  it("canonicalMetricRowsServerCacheKey ignores source and account id order", () => {
    expect(
      canonicalMetricRowsServerCacheKey("p", "2024-01-01", "2024-01-31", {
        sources: ["google", "meta"],
        accountIds: ["b", "a"],
      })
    ).toBe(
      canonicalMetricRowsServerCacheKey("p", "2024-01-01", "2024-01-31", {
        sources: ["meta", "google"],
        accountIds: ["a", "b"],
      })
    );
  });
});
