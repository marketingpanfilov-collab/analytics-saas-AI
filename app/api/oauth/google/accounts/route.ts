import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/app/lib/supabaseAdmin";
import { getValidGoogleAccessToken } from "@/app/lib/googleAdsAuth";
import { requireProjectAccessOrInternal } from "@/app/lib/auth/requireProjectAccessOrInternal";

const LIST_ACCESSIBLE_CUSTOMERS_URL =
  "https://googleads.googleapis.com/v20/customers:listAccessibleCustomers";

function isUuid(v: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(v);
}

function parseCustomerId(rn: string): string | null {
  if (typeof rn !== "string") return null;
  const prefix = "customers/";
  const id = rn.startsWith(prefix) ? rn.slice(prefix.length).trim() : rn.trim();
  return /^\d+(-?\d*)$/.test(id) ? id : null;
}

type CustomerInfo = {
  id: string;
  descriptiveName: string | null;
  manager: boolean;
  currencyCode: CurrencyCode;
};
type ClientInfo = { id: string; descriptiveName: string | null; level: number; currencyCode: string | null };
type CurrencyCode = "USD" | "KZT" | null;

function normalizeCurrencyCode(raw: string | null | undefined): CurrencyCode {
  const v = String(raw ?? "").trim().toUpperCase();
  if (v === "USD" || v === "KZT") return v;
  return null;
}

/**
 * Call Google Ads API Search for a single customer. Returns parsed rows.
 */
async function googleAdsSearch<T>(
  customerId: string,
  accessToken: string,
  developerToken: string,
  query: string
): Promise<T[]> {
  const url = `https://googleads.googleapis.com/v20/customers/${customerId}/googleAds:search`;
  const rows: T[] = [];
  let pageToken: string | undefined;
  do {
    const body: { query: string; pageToken?: string } = { query };
    if (pageToken) body.pageToken = pageToken;
    const res = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "developer-token": developerToken,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    });
    const data = (await res.json().catch(() => ({}))) as {
      results?: unknown[];
      nextPageToken?: string;
      error?: { message?: string };
    };
    if (!res.ok) throw new Error(data?.error?.message ?? `Google Ads API: ${res.status}`);
    if (Array.isArray(data.results)) rows.push(...(data.results as T[]));
    pageToken = data.nextPageToken;
  } while (pageToken);
  return rows;
}

/**
 * Fetch Customer (id, descriptive_name, manager) for one customer ID.
 */
async function fetchCustomerInfo(
  customerId: string,
  accessToken: string,
  developerToken: string
): Promise<CustomerInfo | null> {
  const query =
    "SELECT customer.id, customer.descriptive_name, customer.manager, customer.currency_code FROM customer LIMIT 1";
  const results = await googleAdsSearch<{
    customer?: { id?: string; descriptiveName?: string; manager?: boolean; currencyCode?: string };
  }>(customerId, accessToken, developerToken, query);
  const row = results[0];
  if (!row?.customer?.id) return null;
  const id = String(row.customer.id);
  return {
    id,
    descriptiveName: row.customer.descriptiveName ?? null,
    manager: !!row.customer.manager,
    currencyCode: normalizeCurrencyCode(row.customer.currencyCode ?? null),
  };
}

/**
 * Fetch CustomerClient list for a manager account (level 0 = self, level >= 1 = linked clients).
 */
async function fetchCustomerClients(
  managerCustomerId: string,
  accessToken: string,
  developerToken: string
): Promise<ClientInfo[]> {
  const query =
    "SELECT customer_client.id, customer_client.descriptive_name, customer_client.level, customer_client.currency_code FROM customer_client";
  const results = await googleAdsSearch<{
    customerClient?: { id?: string; descriptiveName?: string; level?: number; currencyCode?: string };
  }>(managerCustomerId, accessToken, developerToken, query);
  const list: ClientInfo[] = [];
  for (const row of results) {
    const c = row?.customerClient;
    if (!c?.id) continue;
    const id = String(c.id);
    const level = typeof c.level === "number" ? c.level : 0;
    list.push({
      id,
      descriptiveName: c.descriptiveName ?? null,
      level,
      currencyCode: normalizeCurrencyCode(c.currencyCode ?? null),
    });
  }
  return list;
}

/**
 * POST /api/oauth/google/accounts
 * Body: { project_id: string }
 *
 * Discovers Google Ads hierarchy (managers/MCC + customers) via:
 * - listAccessibleCustomers
 * - Customer (id, descriptive_name, manager) per accessible id
 * - CustomerClient for each manager to get linked customers
 * Persists into integration_entities (manager + customer, parent_entity_id) and ad_accounts
 * (only customer entities; managers are not reportable).
 */
export async function POST(req: Request) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ success: false, error: "Invalid JSON body" }, { status: 400 });
  }

  const projectId =
    typeof (body as Record<string, unknown>)?.project_id === "string"
      ? ((body as Record<string, unknown>).project_id as string).trim()
      : "";

  if (!projectId || !isUuid(projectId)) {
    return NextResponse.json(
      { success: false, error: "project_id is required and must be a valid UUID" },
      { status: 400 }
    );
  }

  const access = await requireProjectAccessOrInternal(req, projectId, { allowInternalBypass: false });
  if (!access.allowed) {
    return NextResponse.json(access.body, { status: access.status });
  }

  const developerToken = process.env.GOOGLE_ADS_DEVELOPER_TOKEN;
  if (!developerToken) {
    return NextResponse.json(
      { success: false, error: "GOOGLE_ADS_DEVELOPER_TOKEN not set" },
      { status: 500 }
    );
  }

  const admin = supabaseAdmin();

  const { data: proj, error: projErr } = await admin
    .from("projects")
    .select("id, owner_id")
    .eq("id", projectId)
    .maybeSingle();

  if (projErr || !proj) {
    return NextResponse.json(
      { success: false, error: "Project not found" },
      { status: 404 }
    );
  }

  const { data: integration, error: intErr } = await admin
    .from("integrations")
    .select("id")
    .eq("project_id", projectId)
    .eq("platform", "google")
    .maybeSingle();

  if (intErr || !integration?.id) {
    return NextResponse.json(
      { success: false, error: "Google integration not found; connect Google OAuth first" },
      { status: 404 }
    );
  }

  const token = await getValidGoogleAccessToken(admin, integration.id);

  if (!token) {
    return NextResponse.json(
      { success: false, error: "Google auth token not found or expired; reconnect Google OAuth" },
      { status: 401 }
    );
  }

  const accessToken = token.access_token;

  const listRes = await fetch(LIST_ACCESSIBLE_CUSTOMERS_URL, {
    method: "GET",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "developer-token": developerToken,
      "Content-Type": "application/json",
    },
  });

  const listData = (await listRes.json().catch(() => ({}))) as {
    resourceNames?: string[];
    error?: { message?: string };
  };

  if (!listRes.ok) {
    return NextResponse.json(
      {
        success: false,
        error: listData?.error?.message ?? `Google Ads API error: ${listRes.status}`,
      },
      { status: listRes.status >= 400 ? listRes.status : 500 }
    );
  }

  const resourceNames = Array.isArray(listData?.resourceNames) ? listData.resourceNames : [];
  const accessibleIds = resourceNames
    .map((r) => parseCustomerId(r))
    .filter((id): id is string => !!id);

  const customerInfoById = new Map<string, CustomerInfo>();
  for (const id of accessibleIds) {
    try {
      const info = await fetchCustomerInfo(id, accessToken, developerToken);
      if (info) customerInfoById.set(id, info);
    } catch (e) {
      console.warn("[google/accounts] fetchCustomerInfo failed for", id, e);
    }
  }

  const clientListsByManagerId = new Map<string, ClientInfo[]>();
  const allClientIds = new Set<string>();
  for (const id of accessibleIds) {
    const info = customerInfoById.get(id);
    if (!info?.manager) continue;
    try {
      const clients = await fetchCustomerClients(id, accessToken, developerToken);
      const underManager = clients.filter((c) => c.level >= 1);
      clientListsByManagerId.set(id, underManager);
      for (const c of underManager) allClientIds.add(c.id);
    } catch (e) {
      console.warn("[google/accounts] fetchCustomerClients failed for manager", id, e);
    }
  }

  const standaloneCustomerIds = accessibleIds.filter((id) => {
    const info = customerInfoById.get(id);
    if (!info) return false;
    if (info.manager) return false;
    if (allClientIds.has(id)) return false;
    return true;
  });

  const nowIso = new Date().toISOString();
  const integrationId = integration.id;
  const ownerId = (proj as { owner_id?: string | null })?.owner_id ?? null;

  if (ownerId == null) {
    return NextResponse.json(
      { success: false, error: "Project has no owner_id; required for ad_accounts" },
      { status: 500 }
    );
  }

  await admin
    .from("integration_entities")
    .delete()
    .eq("integration_id", integrationId)
    .eq("platform", "google");

  const managerIds = accessibleIds.filter((id) => customerInfoById.get(id)?.manager ?? false);

  const entityRows: {
    integration_id: string;
    project_id: string;
    platform: string;
    entity_type: string;
    external_entity_id: string;
    name: string | null;
    parent_entity_id: string | null;
    meta: unknown;
    updated_at: string;
  }[] = [];

  for (const id of managerIds) {
    const info = customerInfoById.get(id);
    entityRows.push({
      integration_id: integrationId,
      project_id: projectId,
      platform: "google",
      entity_type: "manager",
      external_entity_id: id,
      name: info?.descriptiveName ?? id,
      parent_entity_id: null,
      meta: null,
      updated_at: nowIso,
    });
  }

  for (const id of standaloneCustomerIds) {
    const info = customerInfoById.get(id);
    entityRows.push({
      integration_id: integrationId,
      project_id: projectId,
      platform: "google",
      entity_type: "customer",
      external_entity_id: id,
      name: info?.descriptiveName ?? id,
      parent_entity_id: null,
      meta: null,
      updated_at: nowIso,
    });
  }

  if (entityRows.length > 0) {
    const { error: entitiesErr } = await admin
      .from("integration_entities")
      .upsert(entityRows, { onConflict: "integration_id,entity_type,external_entity_id" });

    if (entitiesErr) {
      return NextResponse.json(
        { success: false, error: entitiesErr.message ?? "integration_entities upsert failed" },
        { status: 500 }
      );
    }
  }

  const { data: existingEntities } = await admin
    .from("integration_entities")
    .select("id, entity_type, external_entity_id")
    .eq("integration_id", integrationId)
    .eq("platform", "google");

  const entityIdByExternal = new Map<string, string>();
  for (const row of (existingEntities ?? []) as { id: string; entity_type: string; external_entity_id: string }[]) {
    entityIdByExternal.set(`${row.entity_type}:${row.external_entity_id}`, row.id);
  }

  const clientEntityRows: typeof entityRows = [];
  for (const [managerId, clients] of clientListsByManagerId) {
    const parentId = entityIdByExternal.get(`manager:${managerId}`);
    if (!parentId) continue;
    for (const client of clients) {
      clientEntityRows.push({
        integration_id: integrationId,
        project_id: projectId,
        platform: "google",
        entity_type: "customer",
        external_entity_id: client.id,
        name: client.descriptiveName ?? client.id,
        parent_entity_id: parentId,
        meta: null,
        updated_at: nowIso,
      });
    }
  }

  if (clientEntityRows.length > 0) {
    const { error: clientErr } = await admin
      .from("integration_entities")
      .upsert(clientEntityRows, { onConflict: "integration_id,entity_type,external_entity_id" });

    if (clientErr) {
      return NextResponse.json(
        { success: false, error: clientErr.message ?? "integration_entities (clients) upsert failed" },
        { status: 500 }
      );
    }
  }

  const customerExternalIds = new Set<string>();
  for (const id of standaloneCustomerIds) customerExternalIds.add(id);
  for (const clients of clientListsByManagerId.values()) {
    for (const c of clients) customerExternalIds.add(c.id);
  }

  await admin.from("ad_accounts").delete().eq("integration_id", integrationId);

  if (customerExternalIds.size > 0) {
    const { data: allCustomerEntities } = await admin
      .from("integration_entities")
      .select("id, external_entity_id")
      .eq("integration_id", integrationId)
      .eq("platform", "google")
      .eq("entity_type", "customer");

  const nameByExternal = new Map<string, string>();
  const currencyByExternal = new Map<string, CurrencyCode>();
    for (const id of standaloneCustomerIds) {
      const info = customerInfoById.get(id);
      nameByExternal.set(id, info?.descriptiveName ?? id);
    currencyByExternal.set(id, normalizeCurrencyCode(info?.currencyCode ?? null));
    }
    for (const clients of clientListsByManagerId.values()) {
      for (const c of clients) {
        nameByExternal.set(c.id, c.descriptiveName ?? c.id);
        currencyByExternal.set(c.id, normalizeCurrencyCode(c.currencyCode));
      }
    }

    const adAccountRows = Array.from(customerExternalIds).map((externalId) => ({
      owner_id: ownerId,
      integration_id: integrationId,
      project_id: projectId,
      provider: "google" as const,
      external_account_id: externalId,
      account_name: nameByExternal.get(externalId) ?? externalId,
      currency: currencyByExternal.get(externalId) ?? null,
    }));

    const { error: adErr } = await admin
      .from("ad_accounts")
      .upsert(adAccountRows, { onConflict: "integration_id,external_account_id" });

    if (adErr) {
      return NextResponse.json(
        { success: false, error: adErr.message ?? "ad_accounts upsert failed" },
        { status: 500 }
      );
    }

    const { data: insertedAccounts } = await admin
      .from("ad_accounts")
      .select("id")
      .eq("integration_id", integrationId);

    const accountIds = (insertedAccounts ?? []) as { id: string }[];
    if (accountIds.length > 0) {
      const settingsRows = accountIds.map(({ id }) => ({
        ad_account_id: id,
        project_id: projectId,
        is_enabled: false,
        selected_for_reporting: false,
        sync_enabled: false,
        updated_at: nowIso,
      }));

      await admin
        .from("ad_account_settings")
        .upsert(settingsRows, { onConflict: "ad_account_id" });
    }
  }

  const underManagerCount = Array.from(clientListsByManagerId.values()).reduce((n, list) => n + list.length, 0);

  return NextResponse.json({
    success: true,
    discovered: {
      managers: managerIds.length,
      customers: customerExternalIds.size,
      standalone: standaloneCustomerIds.length,
      under_managers: underManagerCount,
    },
    customer_ids: Array.from(customerExternalIds),
  });
}
