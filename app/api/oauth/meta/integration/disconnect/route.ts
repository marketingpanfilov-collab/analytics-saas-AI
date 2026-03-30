import { NextResponse } from "next/server";
import { deleteCanonicalIntegrationById } from "@/app/lib/disconnectCanonicalIntegration";
import { getMetaIntegrationForProject } from "@/app/lib/metaIntegration";
import { supabaseAdmin } from "@/app/lib/supabaseAdmin";

/**
 * POST /api/oauth/meta/integration/disconnect
 * Body: { project_id: string }
 *
 * Removes Meta OAuth state: `meta_ad_accounts` for the linked legacy row(s),
 * canonical `integrations` (CASCADE: auth, `ad_accounts`, metrics), then
 * `integrations_meta` rows for this connection. `integrations_meta.integrations_id`
 * is ON DELETE SET NULL — we delete meta rows by id so tokens are not left behind.
 */
export async function POST(req: Request) {
  const body = await req.json().catch(() => ({}));
  const projectId = body?.project_id;

  if (!projectId) {
    return NextResponse.json({ success: false, error: "project_id required" }, { status: 400 });
  }

  const admin = supabaseAdmin();
  const integration = await getMetaIntegrationForProject(admin, projectId);

  if (!integration?.id) {
    return NextResponse.json({ success: true, disconnected: true, message: "Already disconnected" });
  }

  const returnedId = integration.id as string;

  const { data: rowByPk } = await admin
    .from("integrations_meta")
    .select("id, integrations_id")
    .eq("id", returnedId)
    .maybeSingle();

  const metaRowIds = new Set<string>();
  let canonicalIntegrationId: string | null = null;

  if (rowByPk) {
    metaRowIds.add(rowByPk.id);
    canonicalIntegrationId = rowByPk.integrations_id ?? null;
  } else {
    const { data: intRow } = await admin
      .from("integrations")
      .select("id")
      .eq("id", returnedId)
      .eq("project_id", projectId)
      .eq("platform", "meta")
      .maybeSingle();

    if (intRow?.id) {
      canonicalIntegrationId = intRow.id;
    }
  }

  if (canonicalIntegrationId) {
    const { data: siblings } = await admin
      .from("integrations_meta")
      .select("id")
      .eq("project_id", projectId)
      .eq("integrations_id", canonicalIntegrationId);
    for (const r of siblings ?? []) {
      metaRowIds.add((r as { id: string }).id);
    }
  }

  const metaAccKeys = new Set<string>([...metaRowIds, returnedId]);
  for (const integrationMetaId of metaAccKeys) {
    const { error: metaAccErr } = await admin
      .from("meta_ad_accounts")
      .delete()
      .eq("project_id", projectId)
      .eq("integration_id", integrationMetaId);

    if (metaAccErr) {
      return NextResponse.json(
        { success: false, error: metaAccErr.message ?? "Failed to delete meta_ad_accounts" },
        { status: 500 }
      );
    }
  }

  if (canonicalIntegrationId) {
    const { error: delErr } = await deleteCanonicalIntegrationById(admin, canonicalIntegrationId, {
      integrationEntitiesPlatform: "meta",
    });
    if (delErr) {
      return NextResponse.json(
        { success: false, error: delErr.message ?? "Failed to delete Meta integration" },
        { status: 500 }
      );
    }
  }

  if (metaRowIds.size > 0) {
    const { error: metaErr } = await admin.from("integrations_meta").delete().in("id", [...metaRowIds]);
    if (metaErr) {
      return NextResponse.json(
        { success: false, error: metaErr.message ?? "Failed to delete integrations_meta" },
        { status: 500 }
      );
    }
  }

  return NextResponse.json({
    success: true,
    disconnected: true,
    message: "Meta integration disconnected.",
  });
}
