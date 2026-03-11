import { Suspense } from "react";
import AccountsPageClient from "./AccountsPageClient";

export const dynamic = "force-dynamic";

function AccountsFallback() {
  return (
    <div className="flex min-h-[60vh] items-center justify-center bg-[#0b0b10]" style={{ gridColumn: "2 / -1" }}>
      <div className="h-10 w-48 rounded-xl bg-white/[0.06]" />
    </div>
  );
}

export default function AccountsPage() {
  return (
    <Suspense fallback={<AccountsFallback />}>
      <AccountsPageClient />
    </Suspense>
  );
}
