import Link from "next/link";

export function cn(...v: Array<string | false | null | undefined>) {
  return v.filter(Boolean).join(" ");
}

export function BaseButton({
  children,
  href,
  variant = "outline",
  full = false,
}: {
  children: React.ReactNode;
  href: string;
  /** Как primary, но emerald — в одном тоне с карточками BoardIQ / выделенным тарифом */
  variant?: "primary" | "primaryEmerald" | "secondary" | "outline";
  full?: boolean;
}) {
  return (
    <Link
      href={href}
      className={cn(
        "inline-flex h-12 items-center justify-center rounded-xl px-6",
        "text-sm font-extrabold transition",
        full ? "w-full" : "min-w-[148px]",
        variant === "primary" &&
          "border border-[rgba(34,197,94,0.36)] bg-[rgba(34,197,94,0.18)] text-white shadow-[0_10px_30px_rgba(34,197,94,0.14)] hover:bg-[rgba(34,197,94,0.26)] hover:shadow-[0_0_30px_rgba(34,197,94,0.18)]",
        variant === "primaryEmerald" &&
          "border border-emerald-400/40 bg-emerald-500/[0.18] text-white shadow-[0_10px_30px_rgba(16,185,129,0.16)] hover:bg-emerald-500/[0.28] hover:shadow-[0_0_30px_rgba(16,185,129,0.22)]",
        variant === "secondary" &&
          "border border-white/12 bg-white/8 text-white/92 hover:bg-white/12",
        variant === "outline" &&
          "border border-white/12 bg-transparent text-white/78 hover:bg-white/6",
      )}
    >
      {children}
    </Link>
  );
}
