"use client";

import type { BillingWidgetStatePack } from "@/app/lib/billingWidgetState";

type Props = {
  pack: BillingWidgetStatePack;
  minHeight?: number;
  ctaLabel?: string;
  onCtaClick?: () => void;
  /** Мелкий текст под основным описанием (например, доступность тарифов). */
  footerNote?: string;
  /** Спокойный premium-upsell (зелёный акцент) вместо жёлтого LIMITED / красного BLOCKED. */
  visualTone?: "default" | "premium";
};

function WidgetSkeleton({ minHeight }: { minHeight: number }) {
  const bar = (w: string) => (
    <div
      style={{
        height: 12,
        width: w,
        borderRadius: 8,
        background: "rgba(255,255,255,0.08)",
        animation: "billing-widget-pulse 1.2s ease-in-out infinite",
      }}
    />
  );
  return (
    <div
      role="status"
      aria-busy="true"
      aria-label="Загрузка"
      style={{
        minHeight,
        borderRadius: 16,
        border: "1px solid rgba(255,255,255,0.08)",
        background: "rgba(255,255,255,0.03)",
        padding: 20,
        display: "flex",
        flexDirection: "column",
        justifyContent: "center",
        gap: 14,
        boxSizing: "border-box",
      }}
    >
      <style>{`@keyframes billing-widget-pulse { 0%,100%{opacity:1} 50%{opacity:0.45} }`}</style>
      {bar("42%")}
      {bar("78%")}
      {bar("56%")}
    </div>
  );
}

export default function BillingWidgetPlaceholder({
  pack,
  minHeight = 200,
  ctaLabel,
  onCtaClick,
  footerNote,
  visualTone = "default",
}: Props) {
  if (pack.state === "LOADING") {
    return <WidgetSkeleton minHeight={minHeight} />;
  }

  if (pack.state === "EMPTY" && !pack.title) return null;

  const premium = visualTone === "premium";
  const border = premium
    ? "rgba(80, 255, 180, 0.25)"
    : pack.state === "BLOCKED"
      ? "rgba(255,100,100,0.35)"
      : pack.state === "LIMITED"
        ? "rgba(250,200,80,0.35)"
        : "rgba(255,255,255,0.1)";
  const bg = premium
    ? "radial-gradient(ellipse 140% 90% at 50% -20%, rgba(52, 211, 153, 0.18), transparent 52%), radial-gradient(ellipse 80% 60% at 80% 100%, rgba(16, 185, 129, 0.08), transparent 45%), rgba(255,255,255,0.03)"
    : pack.state === "BLOCKED"
      ? "rgba(40,20,20,0.5)"
      : pack.state === "LIMITED"
        ? "rgba(50,45,20,0.45)"
        : "rgba(255,255,255,0.03)";
  const boxShadow = premium ? "0 12px 40px rgba(34, 197, 94, 0.12), 0 0 0 1px rgba(52, 211, 153, 0.06) inset" : undefined;

  return (
    <div
      role="status"
      style={{
        minHeight,
        borderRadius: 16,
        border: `1px solid ${border}`,
        background: bg,
        boxShadow,
        padding: 20,
        display: "flex",
        flexDirection: "column",
        justifyContent: "center",
        gap: 8,
        boxSizing: "border-box",
      }}
    >
      {pack.title ? (
        <div
          style={{
            fontWeight: 800,
            fontSize: 15,
            color: premium ? "rgba(220, 252, 231, 0.98)" : "white",
            letterSpacing: premium ? "-0.01em" : undefined,
          }}
        >
          {pack.title}
        </div>
      ) : null}
      {pack.hint ? (
        <div
          style={{
            fontSize: 13,
            lineHeight: 1.45,
            color: "rgba(255,255,255,0.72)",
            whiteSpace: "pre-line",
          }}
        >
          {pack.hint}
        </div>
      ) : null}
      {footerNote ? (
        <div
          style={{
            fontSize: 12,
            lineHeight: 1.4,
            color: "rgba(255,255,255,0.5)",
            marginTop: 2,
          }}
        >
          {footerNote}
        </div>
      ) : null}
      {ctaLabel && onCtaClick ? (
        <button
          type="button"
          onClick={(e) => {
            e.preventDefault();
            e.stopPropagation();
            onCtaClick();
          }}
          className="mt-1 w-fit cursor-pointer rounded-[10px] bg-emerald-600 px-4 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-emerald-500 focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400/80"
        >
          {ctaLabel}
        </button>
      ) : null}
    </div>
  );
}
