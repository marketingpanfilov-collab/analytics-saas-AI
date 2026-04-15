"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { useBillingBootstrap } from "../../../components/BillingBootstrapProvider";

/**
 * Post-checkout onboarding: подложка под PostCheckoutOnboardingModal.
 * Маршрут /app/projects/onboarding — первый продуктовый шаг после подтверждения email / оплаты.
 */
export default function ProjectsOnboardingPage() {
  const router = useRouter();
  const { bootstrap, loading } = useBillingBootstrap();

  /**
   * После завершения онбординга сервер выставляет requires_post_checkout_onboarding === false.
   * Показываем «Подождите…» и на время `loading === true` после reloadBootstrap — иначе
   * условие «только !loading» не срабатывало, и подложка снова показывала заголовок.
   */
  const postCheckoutOnboardingDone =
    bootstrap != null && bootstrap.requires_post_checkout_onboarding === false;

  useEffect(() => {
    if (loading) return;
    if (!bootstrap) return;
    // Источник истины — серверный флаг, не showPostCheckoutModal (он может отставать от bootstrap).
    if (bootstrap.requires_post_checkout_onboarding === true) return;
    router.replace("/app/projects");
  }, [loading, bootstrap, router]);

  if (postCheckoutOnboardingDone) {
    return (
      <div
        className="flex w-full items-center justify-center px-6"
        style={{ minHeight: "calc(100dvh - 64px)" }}
      >
        <p className="text-center text-base text-zinc-500">Подождите…</p>
      </div>
    );
  }

  return (
    <div
      style={{
        maxWidth: 520,
        margin: "48px auto",
        padding: "0 20px",
        color: "rgba(245,245,250,0.92)",
      }}
    >
      <h1 style={{ fontSize: 22, fontWeight: 700, margin: "0 0 12px" }}>Настройка рабочего пространства</h1>
      <p style={{ fontSize: 14, lineHeight: 1.55, color: "rgba(245,245,250,0.65)", margin: 0 }}>
        Завершите шаги в окне поверх страницы — затем можно перейти к проектам.
      </p>
    </div>
  );
}
