import Link from "next/link";
import { redirect } from "next/navigation";
import { getCurrentSystemRoleCheck } from "@/app/lib/auth/systemRoles";

export const dynamic = "force-dynamic";

export default async function InternalAdminLayout({ children }: { children: React.ReactNode }) {
  const auth = await getCurrentSystemRoleCheck(["service_admin", "support", "ops_manager"]);
  if (!auth.isAuthenticated) {
    redirect("/login");
  }
  if (!auth.hasAnyAllowedRole) {
    redirect("/app");
  }

  const navItem = (href: string, label: string) => (
    <Link
      key={href}
      href={href}
      className="rounded-lg border border-white/10 bg-white/[0.03] px-3 py-2 text-sm text-white/85 transition hover:bg-white/[0.07]"
    >
      {label}
    </Link>
  );

  return (
    <div className="min-h-screen bg-[#0b0b10] text-white">
      <div className="mx-auto flex max-w-6xl items-center justify-between px-5 py-4">
        <div className="text-base font-semibold">Internal Admin</div>
        <div className="flex flex-wrap items-center gap-2">
          {navItem("/app/internal-admin/support", "Support")}
          {navItem("/app/internal-admin/billing", "Billing")}
          {navItem("/app/internal-admin/users", "Users")}
          {navItem("/app", "Back to app")}
        </div>
      </div>
      <div className="mx-auto max-w-6xl px-5 pb-8">{children}</div>
    </div>
  );
}

