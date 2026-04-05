import type { SupabaseClient } from "@supabase/supabase-js";

export type FinalizeOrganizationOwnershipTransferParams = {
  organizationId: string;
  fromUserId: string;
  toUserId: string;
  /** Сообщение, если from_user_id больше не owner (для accept — RU, для transfer-ownership — EN). */
  notCurrentOwnerMessage?: string;
  /** Если удаление organization_members прежнего owner упало после успешного снятия project_members. */
  organizationMembersDeleteFailedMessage?: string;
};

export type FinalizeOrganizationOwnershipTransferResult =
  | { ok: true }
  | { ok: false; error: string; status: number };

const DEFAULT_NOT_OWNER_RU =
  "Передача недействительна: владелец организации изменился. Запросите новую ссылку у действующего владельца.";

const DEFAULT_OM_DELETE_FAILED_RU =
  "Не удалось завершить передачу: удаление прежнего владельца из организации. Обратитесь в поддержку — доступ к проектам уже снят.";

/**
 * Новый пользователь становится owner; прежний owner полностью удаляется из organization_members
 * и из project_members по всем проектам организации.
 *
 * Порядок: новый owner в organization_members → снятие project_members с прежнего owner → удаление строки прежнего owner.
 * Подписка и entitlements привязаны к organization_id и не меняются.
 */
export async function finalizeOrganizationOwnershipTransfer(
  admin: SupabaseClient,
  params: FinalizeOrganizationOwnershipTransferParams
): Promise<FinalizeOrganizationOwnershipTransferResult> {
  const { organizationId: orgId, fromUserId, toUserId } = params;
  const notOwnerMsg = params.notCurrentOwnerMessage ?? DEFAULT_NOT_OWNER_RU;
  const omDeleteFailedMsg = params.organizationMembersDeleteFailedMessage ?? DEFAULT_OM_DELETE_FAILED_RU;

  if (fromUserId === toUserId) {
    return { ok: false, error: "fromUserId and toUserId must differ", status: 400 };
  }

  const { data: fromMem, error: fromMemErr } = await admin
    .from("organization_members")
    .select("id, role")
    .eq("organization_id", orgId)
    .eq("user_id", fromUserId)
    .maybeSingle();

  if (fromMemErr) {
    return { ok: false, error: fromMemErr.message, status: 500 };
  }
  if (!fromMem || fromMem.role !== "owner") {
    return { ok: false, error: notOwnerMsg, status: 409 };
  }

  const { data: existingNewMem, error: newFetchErr } = await admin
    .from("organization_members")
    .select("id, role")
    .eq("organization_id", orgId)
    .eq("user_id", toUserId)
    .maybeSingle();

  if (newFetchErr) {
    return { ok: false, error: newFetchErr.message, status: 500 };
  }

  const previousNewRole = existingNewMem?.role ?? null;
  const newMemberRowId = existingNewMem?.id ?? null;

  if (existingNewMem) {
    const { error: promoteErr } = await admin
      .from("organization_members")
      .update({ role: "owner" })
      .eq("id", existingNewMem.id);
    if (promoteErr) {
      return { ok: false, error: promoteErr.message, status: 500 };
    }
  } else {
    const { error: insErr } = await admin.from("organization_members").insert({
      organization_id: orgId,
      user_id: toUserId,
      role: "owner",
    });
    if (insErr) {
      return { ok: false, error: insErr.message, status: 500 };
    }
  }

  async function rollbackNewOwner(): Promise<void> {
    if (newMemberRowId) {
      await admin
        .from("organization_members")
        .update({ role: previousNewRole ?? "member" })
        .eq("id", newMemberRowId);
    } else {
      await admin.from("organization_members").delete().eq("organization_id", orgId).eq("user_id", toUserId);
    }
  }

  const { data: projRows, error: pErr } = await admin.from("projects").select("id").eq("organization_id", orgId);
  if (pErr) {
    await rollbackNewOwner();
    return { ok: false, error: pErr.message, status: 500 };
  }
  const projectIds = (projRows ?? []).map((p: { id: string }) => String(p.id)).filter(Boolean);

  if (projectIds.length > 0) {
    const { error: pmDelErr } = await admin
      .from("project_members")
      .delete()
      .eq("user_id", fromUserId)
      .in("project_id", projectIds);
    if (pmDelErr) {
      await rollbackNewOwner();
      return { ok: false, error: pmDelErr.message, status: 500 };
    }
  }

  const { error: omDelErr } = await admin
    .from("organization_members")
    .delete()
    .eq("organization_id", orgId)
    .eq("user_id", fromUserId);

  if (omDelErr) {
    console.error("[finalizeOrganizationOwnershipTransfer] organization_members delete failed after PM cleanup", omDelErr);
    return {
      ok: false,
      error: omDeleteFailedMsg,
      status: 500,
    };
  }

  return { ok: true };
}
