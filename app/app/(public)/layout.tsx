"use client";

/**
 * Minimal layout for public pages (e.g. shared report). No sidebar, no topbar.
 */
export default function PublicLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-[#0b0b10]">
      {children}
    </div>
  );
}
