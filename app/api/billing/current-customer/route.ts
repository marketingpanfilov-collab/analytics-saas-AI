import { NextResponse } from "next/server";
import { createServerSupabase } from "@/app/lib/supabaseServer";
import { supabaseAdmin } from "@/app/lib/supabaseAdmin";
import { getAccessibleProjectIds, resolveBillingOrganizationId } from "@/app/lib/billingOrganizationContext";
import { collectPaddleCustomerIdsForOrganization } from "@/app/lib/orgBillingState";

export async function GET() {
  const supabase = await createServerSupabase();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 });
  }

  const admin = supabaseAdmin();
  const projectIds = await getAccessibleProjectIds(admin, user.id);
  const billingOrgId = await resolveBillingOrganizationId(admin, user.id, null, projectIds);

  if (!billingOrgId) {
    return NextResponse.json({ success: true, customer_id: null });
  }

  const paddleIds = await collectPaddleCustomerIdsForOrganization(admin, billingOrgId);
  const customerId = paddleIds.find((id) => id.startsWith("ctm_")) ?? null;
  return NextResponse.json({ success: true, customer_id: customerId });
}
