import type { CSSProperties } from "react";

/** Фон страницы отчёта (как LTV). */
export const REPORT_PAGE_BG = "#0a0a0a";

/** Карточка секции — зеркало LTV customCardStyle. */
export const reportCardStyle: CSSProperties = {
  background: "#161616",
  border: "1px solid rgba(255,255,255,0.08)",
  borderRadius: 16,
  padding: 16,
  boxShadow: "0 12px 40px rgba(0,0,0,0.35)",
};

export const reportSectionLabelStyle: CSSProperties = {
  fontSize: 11,
  fontWeight: 700,
  opacity: 0.55,
  textTransform: "uppercase",
  letterSpacing: "0.05em",
  marginBottom: 0,
};

export const reportFilterColumnStyle: CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: 6,
  width: "fit-content",
  maxWidth: "100%",
};

export const reportFilterLabelRowStyle: CSSProperties = {
  ...reportSectionLabelStyle,
  display: "flex",
  alignItems: "center",
  gap: 6,
  paddingLeft: 16,
  paddingRight: 14,
  boxSizing: "border-box",
  width: "100%",
  minWidth: 0,
};

export const reportFilterDropdownWrapStyle: CSSProperties = {
  height: 44,
  padding: "0 14px",
  borderRadius: 12,
  fontSize: 13,
  background: "#1c1c1c",
  border: "1px solid rgba(255,255,255,0.1)",
  color: "#fff",
  minWidth: 160,
  display: "flex",
  alignItems: "center",
  justifyContent: "space-between",
  gap: 8,
  boxSizing: "border-box",
};

export const reportFilterInputStyle: CSSProperties = {
  flex: 1,
  minWidth: 0,
  height: "100%",
  border: "none",
  background: "transparent",
  color: "#fff",
  fontSize: 13,
  outline: "none",
};

export const reportFilterSelectStyle: CSSProperties = {
  ...reportFilterInputStyle,
  cursor: "pointer",
  appearance: "none",
  WebkitAppearance: "none",
  paddingRight: 4,
};

export const reportFilterChevronStyle: CSSProperties = {
  width: 16,
  height: 16,
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  opacity: 0.6,
  flexShrink: 0,
  pointerEvents: "none",
};

/** Минимальный размер числа KPI в обзоре (читаемость). */
export const REPORT_OVERVIEW_VALUE_MIN_PX = 24;

/** Стартовый размер авто-подгонки числа в обзоре. */
export const REPORT_OVERVIEW_VALUE_START_PX = 36;

export function ReportFilterChevron() {
  return (
    <span style={reportFilterChevronStyle} aria-hidden>
      <svg width="10" height="6" viewBox="0 0 10 6" fill="none" xmlns="http://www.w3.org/2000/svg">
        <path
          d="M1 1L5 5L9 1"
          stroke="currentColor"
          strokeWidth="1.5"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    </span>
  );
}
