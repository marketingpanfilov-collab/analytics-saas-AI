export const PARTNERSHIP_COLLABORATION_OPTIONS = [
  { id: "product_sales", label: "Продажа продукта" },
  { id: "investments", label: "Инвестиции" },
  { id: "referral", label: "Реферальная программа" },
  { id: "pr_marketing", label: "PR & Marketing" },
] as const;

export type PartnershipCollaborationId = (typeof PARTNERSHIP_COLLABORATION_OPTIONS)[number]["id"];

export function isValidCollaborationId(v: string | null | undefined): v is PartnershipCollaborationId {
  return (
    v != null &&
    (PARTNERSHIP_COLLABORATION_OPTIONS as readonly { id: string }[]).some((o) => o.id === v)
  );
}

export function collaborationLabel(id: PartnershipCollaborationId): string {
  const o = PARTNERSHIP_COLLABORATION_OPTIONS.find((x) => x.id === id);
  return o?.label ?? id;
}
