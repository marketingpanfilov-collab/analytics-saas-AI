export type DashboardSummary = {
    success: true;
    source: string;
    updated_at: string | null;
    totals: {
      spend: number;
      clicks: number;
      leads: number;
      sales: number;
      revenue: number;
      roas: number;
      cpl: number;
      cac: number;
    };
    debug?: {
      min_day?: string | null;
      max_day?: string | null;
      campaigns_cnt?: number | null;
      ad_account_id?: string | null;
    };
  };
  
  export type DashboardSummaryError = {
    success: false;
    error: any;
  };
  
  export async function fetchDashboardSummary(params: {
    projectId: string;
    start: string; // YYYY-MM-DD
    end: string;   // YYYY-MM-DD
  }): Promise<DashboardSummary> {
    const qs = new URLSearchParams({
      project_id: params.projectId,
      start: params.start,
      end: params.end,
    });
  
    const res = await fetch(`/api/dashboard/summary?${qs.toString()}`, {
      method: "GET",
      cache: "no-store",
    });
  
    const json = (await res.json()) as DashboardSummary | DashboardSummaryError;
  
    if (!res.ok || !("success" in json) || json.success === false) {
      const msg =
        (json as any)?.error?.message ??
        (json as any)?.error ??
        `Request failed: ${res.status}`;
      throw new Error(msg);
    }
  
    return json as DashboardSummary;
  }