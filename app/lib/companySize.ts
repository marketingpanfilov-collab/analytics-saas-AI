/**
 * Диапазоны численности компании.
 *
 * Значения `COMPANY_SIZE_VALUES` должны совпадать с CHECK в БД:
 * `organization_crm_profiles.company_size` — см. миграцию
 * `supabase/migrations/20260402120000_organization_crm_profiles.sql`
 * (IN ('0-20', '20-50', '50-100', '100-500', '500+') или NULL).
 */

export const COMPANY_SIZE_VALUES = ["0-20", "20-50", "50-100", "100-500", "500+"] as const;
export type CompanySizeValue = (typeof COMPANY_SIZE_VALUES)[number];

export const COMPANY_SIZE_LABEL_BY_VALUE: Record<CompanySizeValue, string> = {
  "0-20": "До 20 сотрудников",
  "20-50": "21–50 сотрудников",
  "50-100": "51–100 сотрудников",
  "100-500": "101–500 сотрудников",
  "500+": "Свыше 500 сотрудников",
};

/**
 * Опции для выпадающего списка (select).
 * @param includeUnset — если true, первая опция «Не указано» (value ""), в БД сохраняется как NULL.
 *   После выбора диапазона передавайте false, чтобы нельзя было снова выбрать «Не указано» из списка.
 */
export function getCompanySizeSelectOptions(includeUnset: boolean): { value: string; label: string }[] {
  const core = COMPANY_SIZE_VALUES.map((value) => ({
    value,
    label: COMPANY_SIZE_LABEL_BY_VALUE[value],
  }));
  if (!includeUnset) return core;
  return [{ value: "", label: "Не указано" }, ...core];
}

export function formatCompanySizeLabel(value: string | null | undefined): string {
  if (value == null || value === "") return "—";
  return COMPANY_SIZE_LABEL_BY_VALUE[value as CompanySizeValue] ?? value;
}

export function isCompanySizeValue(v: unknown): v is CompanySizeValue {
  return typeof v === "string" && (COMPANY_SIZE_VALUES as readonly string[]).includes(v);
}
