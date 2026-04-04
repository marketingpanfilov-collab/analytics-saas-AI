"use client";

import type { BillingWidgetStatePack } from "@/app/lib/billingWidgetState";

type Props = {
  pack: BillingWidgetStatePack;
  minHeight?: number;
};

export default function BillingWidgetPlaceholder({ pack, minHeight = 200 }: Props) {
  if (pack.state === "EMPTY" && !pack.title) return null;

  const border =
    pack.state === "BLOCKED"
      ? "rgba(255,100,100,0.35)"
      : pack.state === "LIMITED"
        ? "rgba(250,200,80,0.35)"
        : "rgba(255,255,255,0.1)";
  const bg =
    pack.state === "BLOCKED"
      ? "rgba(40,20,20,0.5)"
      : pack.state === "LIMITED"
        ? "rgba(50,45,20,0.45)"
        : "rgba(255,255,255,0.03)";

  return (
    <div
      role="status"
      style={{
        minHeight,
        borderRadius: 16,
        border: `1px solid ${border}`,
        background: bg,
        padding: 20,
        display: "flex",
        flexDirection: "column",
        justifyContent: "center",
        gap: 8,
        boxSizing: "border-box",
      }}
    >
      {pack.title ? (
        <div style={{ fontWeight: 800, fontSize: 15, color: "white" }}>{pack.title}</div>
      ) : null}
      {pack.hint ? (
        <div style={{ fontSize: 13, lineHeight: 1.45, color: "rgba(255,255,255,0.72)" }}>{pack.hint}</div>
      ) : null}
      <div style={{ fontSize: 11, opacity: 0.45, color: "rgba(255,255,255,0.8)" }}>
        {pack.reasonCode ? `reason: ${pack.reasonCode}` : null}
      </div>
    </div>
  );
}
