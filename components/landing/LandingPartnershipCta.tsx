"use client";

import { usePartnershipLead } from "@/components/landing/PartnershipLeadProvider";

export function LandingPartnershipCta() {
  const { open } = usePartnershipLead();

  return (
    <section
      id="partnership"
      className="landing-mid-scope relative z-10 scroll-mt-24 border-t border-white/10 py-14 md:py-20"
    >
      <div className="mx-auto max-w-6xl px-5">
        <div className="mx-auto max-w-2xl text-center md:max-w-none">
          <h2 className="text-3xl font-semibold tracking-tight text-white/95 md:text-4xl">
            Хотите сотрудничать с нами?
          </h2>
          <p className="mx-auto mt-4 max-w-2xl text-base leading-relaxed text-white/60 md:mx-auto">
            Оставьте контактные данные — мы обязательно свяжемся с вами в ближайшее время.
          </p>
        </div>

        <div className="mx-auto mt-10 flex justify-center">
          <button
            type="button"
            onClick={open}
            className="inline-flex h-12 min-w-[220px] cursor-pointer items-center justify-center rounded-xl border border-emerald-400/40 bg-emerald-500/[0.18] px-8 text-sm font-extrabold text-white shadow-[0_10px_30px_rgba(16,185,129,0.16)] transition hover:bg-emerald-500/[0.28] hover:shadow-[0_0_30px_rgba(16,185,129,0.22)]"
          >
            Оставить заявку
          </button>
        </div>
      </div>
    </section>
  );
}
