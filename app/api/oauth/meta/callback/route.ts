// app/api/oauth/meta/callback/route.ts
import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/app/lib/supabaseAdmin";
import type { NextRequest } from "next/server";

type FbTokenResponse = {
  access_token?: string;
  token_type?: string;
  expires_in?: number;
  error?: { message: string; type?: string; code?: number; fbtrace_id?: string };
};

type FbBusiness = { id: string; name?: string };

type FbAdAccount = {
  id: string; // "act_123..."
  name?: string;
  account_status?: number;
  currency?: string;
};

async function fbGetJson(url: string) {
  const r = await fetch(url, { method: "GET" });
  const txt = await r.text();
  try {
    return JSON.parse(txt);
  } catch {
    return { error: { message: txt } };
  }
}

function safeJsonStringify(x: any) {
  try {
    return JSON.stringify(x);
  } catch {
    return String(x);
  }
}

/**
 * state ожидаем base64(json) вида:
 *   { "project_id": "<uuid>", "return_to": "/app/accounts?project_id=..." }
 *
 * Backward compatible:
 * - if state is not parseable, we fall back to cookies set by /start
 */
function parseState(state: string | null): { project_id?: string; return_to?: string } {
  if (!state) return {};
  try {
    const json = Buffer.from(state, "base64").toString("utf8");
    return JSON.parse(json);
  } catch {
    return {};
  }
}

function readCookie(req: NextRequest, name: string) {
  return req.cookies.get(name)?.value ?? null;
}

function safeReturnTo(v: string | null | undefined) {
  const s = String(v || "").trim();
  return s.startsWith("/") ? s : null;
}

async function fetchSelectedBusinesses(accessToken: string): Promise<FbBusiness[]> {
  const all: FbBusiness[] = [];
  let url: string | null =
    "https://graph.facebook.com/v19.0/me/businesses?" +
    new URLSearchParams({
      fields: "id,name",
      limit: "200",
      access_token: accessToken,
    }).toString();

  while (url) {
    const json = await fbGetJson(url);
    if (json?.error?.message) throw new Error(json.error.message);
    const data = (json?.data ?? []) as FbBusiness[];
    all.push(...data);
    url = json?.paging?.next ?? null;
  }
  return all;
}

async function fetchBusinessAdAccounts(
  businessId: string,
  accessToken: string,
  edge: "owned_ad_accounts" | "client_ad_accounts"
): Promise<FbAdAccount[]> {
  const all: FbAdAccount[] = [];
  let url: string | null =
    `https://graph.facebook.com/v19.0/${businessId}/${edge}?` +
    new URLSearchParams({
      fields: "id,name,account_status,currency",
      limit: "500",
      access_token: accessToken,
    }).toString();

  while (url) {
    const json = await fbGetJson(url);
    if (json?.error?.message) throw new Error(json.error.message);
    const data = (json?.data ?? []) as FbAdAccount[];
    all.push(...data);
    url = json?.paging?.next ?? null;
  }
  return all;
}

export type MetaCallbackBusinessesAndAccounts = {
  businesses: FbBusiness[];
  adAccounts: FbAdAccount[];
};

/**
 * Fetch only ad accounts that belong to businesses returned by /me/businesses.
 * We do NOT use /me/adaccounts: that endpoint returns all ad accounts the user has access to
 * (including from businesses they did not select during OAuth). Product requirement: only
 * accounts from businesses explicitly selected during Meta authorization.
 * Returns both businesses and ad accounts for use by callback (e.g. integration_entities write).
 */
async function fetchAdAccountsFromSelectedBusinesses(
  accessToken: string
): Promise<MetaCallbackBusinessesAndAccounts> {
  const businesses = await fetchSelectedBusinesses(accessToken);
  console.log("META BUSINESSES (selected scope):", JSON.stringify(businesses, null, 2));
  const map = new Map<string, FbAdAccount>();

  for (const b of businesses) {
    const owned = await fetchBusinessAdAccounts(b.id, accessToken, "owned_ad_accounts");
    console.log("OWNED ACCOUNTS:", JSON.stringify(owned, null, 2));
    for (const a of owned) map.set(a.id, a);

    const client = await fetchBusinessAdAccounts(b.id, accessToken, "client_ad_accounts");
    console.log("CLIENT ACCOUNTS:", JSON.stringify(client, null, 2));
    for (const a of client) map.set(a.id, a);
  }

  const adAccounts = Array.from(map.values());
  console.log("FINAL AD ACCOUNTS (business-scoped only):", adAccounts.length, "ids:", adAccounts.map((a) => a.id));
  return { businesses, adAccounts };
}

export async function GET(req: NextRequest) {
  const { searchParams } = req.nextUrl;

  const code = searchParams.get("code");
  const stateRaw = searchParams.get("state");

  const appId = process.env.META_APP_ID;
  const appSecret = process.env.META_APP_SECRET;
  const redirectUri = process.env.META_REDIRECT_URI;

  if (!code) {
    return NextResponse.json({ success: false, step: "input", error: "Нет параметра code" }, { status: 400 });
  }
  if (!appId || !appSecret || !redirectUri) {
    return NextResponse.json(
      { success: false, step: "config", error: "META_APP_ID / META_APP_SECRET / META_REDIRECT_URI не заданы" },
      { status: 500 }
    );
  }

  // ✅ project_id берем из state (предпочтительно), иначе из cookies (legacy flow)
  const st = parseState(stateRaw);
  const cookieProjectId = readCookie(req, "meta_oauth_project_id");
  const cookieReturnTo = readCookie(req, "meta_oauth_return_to");

  const projectId = st.project_id || cookieProjectId || null;
  const returnToFromState = safeReturnTo(st.return_to);
  const returnToFromCookie = safeReturnTo(cookieReturnTo);

  if (!projectId) {
    return NextResponse.json(
      {
        success: false,
        step: "state",
        error: "Не удалось определить project_id (ожидаем state base64 JSON или cookie from /start)",
        state: stateRaw,
      },
      { status: 400 }
    );
  }

  // ✅ один ключ интеграции на проект (без "default" и дублей)
  const accountId = "primary";

  const admin = supabaseAdmin();

  // ✅ проверяем проект (иначе FK будет падать); берём owner_id для ad_accounts.owner_id (NOT NULL в runtime)
  const { data: proj, error: projErr } = await admin
    .from("projects")
    .select("id, owner_id")
    .eq("id", projectId)
    .maybeSingle();

  if (projErr) {
    return NextResponse.json({ success: false, step: "check_project", error: projErr, state: stateRaw }, { status: 500 });
  }
  if (!proj) {
    return NextResponse.json(
      { success: false, step: "check_project", error: `Project not found: ${projectId}`, state: stateRaw },
      { status: 400 }
    );
  }

  // 1) code -> short-lived token
  const shortUrl =
    `https://graph.facebook.com/v19.0/oauth/access_token?` +
    new URLSearchParams({
      client_id: appId,
      client_secret: appSecret,
      redirect_uri: redirectUri,
      code,
    }).toString();

  const shortJson = (await fbGetJson(shortUrl)) as FbTokenResponse;
  if (!shortJson.access_token) {
    return NextResponse.json(
      { success: false, step: "exchange_code", state: stateRaw, fb: shortJson },
      { status: 400 }
    );
  }

  // 2) short -> long-lived token
  const longUrl =
    `https://graph.facebook.com/v19.0/oauth/access_token?` +
    new URLSearchParams({
      grant_type: "fb_exchange_token",
      client_id: appId,
      client_secret: appSecret,
      fb_exchange_token: shortJson.access_token,
    }).toString();

  const longJson = (await fbGetJson(longUrl)) as FbTokenResponse;
  if (!longJson.access_token) {
    return NextResponse.json(
      { success: false, step: "exchange_long_lived", state: stateRaw, fb: longJson },
      { status: 400 }
    );
  }

  const accessToken = longJson.access_token;
  const expiresIn = longJson.expires_in ?? null;
  const expiresAt = expiresIn != null ? new Date(Date.now() + expiresIn * 1000).toISOString() : null;

  // 3a) Canonical: ensure integrations row exists (dual-write)
  const { data: canonicalInt, error: intUpsertErr } = await admin
    .from("integrations")
    .upsert(
      {
        project_id: projectId,
        platform: "meta",
        name: "Meta Ads",
        updated_at: new Date().toISOString(),
      },
      { onConflict: "project_id,platform" }
    )
    .select("id")
    .single();

  if (intUpsertErr || !canonicalInt?.id) {
    return NextResponse.json(
      { success: false, step: "integrations_upsert", error: intUpsertErr, state: stateRaw },
      { status: 500 }
    );
  }
  const integrationsId = canonicalInt.id;

  // 3b) UPSERT token — legacy (integrations_meta) + primary shared layer (integrations_auth)
  const { error: upsertErr } = await admin
    .from("integrations_meta")
    .upsert(
      {
        project_id: projectId,
        account_id: accountId,
        integrations_id: integrationsId,
        access_token: accessToken,
        expires_at: expiresAt,
        token_source: "oauth_meta",
      },
      { onConflict: "project_id,account_id" }
    );

  if (upsertErr) {
    return NextResponse.json(
      { success: false, step: "supabase_upsert", error: upsertErr, state: stateRaw },
      { status: 500 }
    );
  }

  const nowIso = new Date().toISOString();
  const { error: authErr } = await admin
    .from("integrations_auth")
    .upsert(
      {
        integration_id: integrationsId,
        access_token: accessToken,
        refresh_token: null,
        token_expires_at: expiresAt,
        scopes: null,
        meta: {
          token_type: longJson.token_type ?? null,
          expires_in: expiresIn,
          source: "meta_oauth_callback",
        },
        updated_at: nowIso,
      },
      { onConflict: "integration_id" }
    );

  if (authErr) {
    return NextResponse.json(
      { success: false, step: "integrations_auth_upsert", error: authErr, state: stateRaw },
      { status: 500 }
    );
  }

  // 4) get integration_id
  const { data: integrationRow, error: integrationErr } = await admin
    .from("integrations_meta")
    .select("id")
    .eq("project_id", projectId)
    .eq("account_id", accountId)
    .single();

  if (integrationErr || !integrationRow) {
    return NextResponse.json(
      { success: false, step: "get_integration_id", error: integrationErr, state: stateRaw },
      { status: 500 }
    );
  }

  const integrationId = integrationRow.id;

  // 5) берём businesses + ad accounts из выбранных Business (all pages; deduped by id)
  let businesses: FbBusiness[] = [];
  let adAccounts: FbAdAccount[] = [];
  try {
    const result = await fetchAdAccountsFromSelectedBusinesses(accessToken);
    businesses = result.businesses;
    adAccounts = result.adAccounts;
  } catch (e: any) {
    return NextResponse.json(
      { success: false, step: "fetch_business_ad_accounts", error: e?.message ?? String(e), state: stateRaw },
      { status: 400 }
    );
  }

  // 5b) Platform-agnostic entity layer: write Meta businesses to integration_entities (foundation for hierarchy)
  if (businesses.length > 0) {
    await admin
      .from("integration_entities")
      .delete()
      .eq("integration_id", integrationsId)
      .eq("platform", "meta")
      .eq("entity_type", "business");

    const nowIso = new Date().toISOString();
    const entityRows = businesses.map((b) => ({
      integration_id: integrationsId,
      project_id: projectId,
      platform: "meta",
      entity_type: "business",
      external_entity_id: b.id,
      name: b.name ?? null,
      parent_entity_id: null,
      meta: null,
      updated_at: nowIso,
    }));
    const { error: entitiesErr } = await admin
      .from("integration_entities")
      .upsert(entityRows, { onConflict: "integration_id,entity_type,external_entity_id" });

    if (entitiesErr) {
      return NextResponse.json(
        { success: false, step: "integration_entities_upsert", error: entitiesErr, state: stateRaw },
        { status: 500 }
      );
    }
  }

  // Diagnostic: what Meta returned (count + id/name per account)
  console.log("[meta_callback] Meta ad accounts count:", adAccounts.length, "ids:", adAccounts.map((a) => ({ id: a.id, name: a.name ?? null })));

  // ✅ privacy/clean: удаляем старые кабинеты по этой интеграции (legacy + canonical)
  await admin
    .from("meta_ad_accounts")
    .delete()
    .eq("project_id", projectId)
    .eq("integration_id", integrationId);

  await admin.from("ad_accounts").delete().eq("integration_id", integrationsId);

  if (adAccounts.length > 0) {
    // Discovered accounts are not enabled until the user saves selection (connections/save).
    const rows = adAccounts.map((a) => ({
      project_id: projectId,
      integration_id: integrationId,
      ad_account_id: a.id, // act_...
      name: a.name ?? null,
      currency: a.currency ?? null,
      account_status: a.account_status ?? null,
      is_enabled: false,
    }));

    const { error: accUpsertErr } = await admin
      .from("meta_ad_accounts")
      .upsert(rows, { onConflict: "project_id,ad_account_id" });

    if (accUpsertErr) {
      return NextResponse.json(
        { success: false, step: "upsert_meta_ad_accounts", error: accUpsertErr, state: stateRaw },
        { status: 500 }
      );
    }

    // owner_id: required by runtime ad_accounts. Prefer project owner; fallback to canonical integration if needed.
    let ownerId: string | null = proj?.owner_id ?? null;
    if (ownerId == null) {
      const { data: intRow } = await admin
        .from("integrations")
        .select("owner_id")
        .eq("id", integrationsId)
        .maybeSingle();
      ownerId = (intRow as { owner_id?: string } | null)?.owner_id ?? null;
    }
    if (ownerId == null) {
      return NextResponse.json(
        {
          success: false,
          step: "get_owner_id",
          error: "project and integration have no owner_id; ad_accounts.owner_id is required",
          state: stateRaw,
        },
        { status: 500 }
      );
    }

    // Canonical: dual-write ad_accounts (runtime schema: owner_id, integration_id, project_id, provider, external_account_id, account_name)
    const adAccountRows = adAccounts.map((a) => ({
      owner_id: ownerId,
      integration_id: integrationsId,
      project_id: projectId,
      provider: "meta",
      external_account_id: a.id,
      account_name: a.name ?? null,
    }));
    console.log("[meta_callback] ad_accounts upsert rows count:", adAccountRows.length, "external_account_ids:", adAccountRows.map((r) => r.external_account_id));
    const { error: adAccErr } = await admin
      .from("ad_accounts")
      .upsert(adAccountRows, { onConflict: "integration_id,external_account_id" });

    if (adAccErr) {
      return NextResponse.json(
        { success: false, step: "upsert_ad_accounts", error: adAccErr, state: stateRaw },
        { status: 500 }
      );
    }
  }

  // 6) редирект обратно в UI
  const returnTo =
    returnToFromState ||
    returnToFromCookie ||
    `/app/accounts?project_id=${encodeURIComponent(projectId)}&connected=meta`;

  return NextResponse.redirect(new URL(returnTo, req.nextUrl.origin), { status: 302 });
}