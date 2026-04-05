"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { useBillingBootstrap } from "../../components/BillingBootstrapProvider";

/**
 * Экран после первой оплаты: подложка под PostCheckoutOnboardingModal.
 * Не показывает список проектов до завершения онбординга.
 */
export default function PostCheckoutOnboardingPage() {
  const router = useRouter();
  const { bootstrap, loading, showPostCheckoutModal } = useBillingBootstrap();

  useEffect(() => {
    if (loading) return;
    if (!bootstrap) return;
    if (!showPostCheckoutModal) {
      router.replace("/app/projects");
    }
  }, [loading, bootstrap, showPostCheckoutModal, router]);

  return (
    <div
      style={{
        maxWidth: 520,
        margin: "48px auto",
        padding: "0 20px",
        color: "rgba(245,245,250,0.92)",
      }}
    >
      <h1 style={{ fontSize: 22, fontWeight: 700, margin: "0 0 12px" }}>Настройка аккаунта</h1>
      <p style={{ fontSize: 14, lineHeight: 1.55, color: "rgba(245,245,250,0.65)", margin: 0 }}>
        Завершите шаги в окне поверх страницы — после этого откроется доступ к проектам и аналитике.
      </p>
    </div>
  );
}
