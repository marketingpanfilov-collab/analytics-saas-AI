import Link from "next/link";
import RegisterWithCheckout from "@/components/auth/RegisterWithCheckout";
import { getPriceIdByPlan, normalizePlanId } from "@/lib/billing/plans";

type RegisterPageProps = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

export const dynamic = "force-dynamic";

export default async function RegisterPage({ searchParams }: RegisterPageProps) {
  const params = await searchParams;
  const rawPlan = params.plan;
  const rawBilling = params.billing;

  const plan = Array.isArray(rawPlan) ? rawPlan[0] : (rawPlan ?? null);
  const billingValue = Array.isArray(rawBilling) ? rawBilling[0] : rawBilling;
  const billing: "monthly" | "yearly" = billingValue === "yearly" ? "yearly" : "monthly";

  const normalizedPlan = normalizePlanId(plan);
  const priceId = getPriceIdByPlan(plan, billing);

  if (!normalizedPlan || !priceId) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-[#0b0b10] px-6 text-white">
        <div className="w-full max-w-xl rounded-2xl border border-white/10 bg-white/[0.03] p-6">
          <h1 className="text-xl font-semibold text-white">Неверный тариф</h1>
          <p className="mt-2 text-sm text-zinc-400">
            Выберите тариф на странице тарифов, затем повторите регистрацию.
          </p>
          <Link
            href="/#pricing"
            className="mt-5 inline-flex h-10 items-center rounded-xl border border-white/15 bg-white/[0.06] px-4 text-sm font-medium text-white/90 transition hover:bg-white/[0.1]"
          >
            Перейти к тарифам
          </Link>
        </div>
      </main>
    );
  }

  return <RegisterWithCheckout plan={normalizedPlan} billing={billing} />;
}
