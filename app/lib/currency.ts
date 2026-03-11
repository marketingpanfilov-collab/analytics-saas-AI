export type ProjectCurrency = "USD" | "KZT";

export function convertUsdToProjectCurrency(
  valueUsd: number,
  currency: ProjectCurrency,
  usdToKztRate: number | null
): number {
  if (!Number.isFinite(valueUsd)) return 0;
  if (currency === "KZT" && usdToKztRate && usdToKztRate > 0) {
    return valueUsd * usdToKztRate;
  }
  return valueUsd;
}

export function fmtProjectCurrency(
  valueUsd: number,
  currency: ProjectCurrency,
  usdToKztRate: number | null
): string {
  const v = convertUsdToProjectCurrency(valueUsd, currency, usdToKztRate);
  if (currency === "USD") {
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: "USD",
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(v);
  }
  // KZT – без копеек, с символом ₸
  const formatted = new Intl.NumberFormat("ru-RU", {
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(Math.round(v));
  return `₸${formatted}`;
}

/** Форматирование суммы в USD (для отображения в плане, где значения хранятся в USD). */
export function fmtUsd(valueUsd: number): string {
  if (!Number.isFinite(valueUsd)) return "$0.00";
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(valueUsd);
}

