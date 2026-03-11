export default function AppRootLayout({ children }: { children: React.ReactNode }) {
  // Layout is split via route groups:
  // - /app/(with-sidebar) → main app shell with Sidebar + Topbar
  // - /app/(no-sidebar)   → project-selection / invite flow without Sidebar
  return (
    <div style={{ minHeight: "100vh", background: "#0b0b10" }}>
      {children}
    </div>
  );
}