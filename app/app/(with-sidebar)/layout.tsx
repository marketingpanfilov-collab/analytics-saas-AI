"use client";

import { Suspense, useEffect, useRef, useState } from "react";
import DevAbortRejectionSuppressor from "../components/DevAbortRejectionSuppressor";
import { BillingBootstrapProvider } from "../components/BillingBootstrapProvider";
import { BillingPricingModalProvider } from "../components/BillingPricingModalProvider";
import {
  BillingAccessStricterBanner,
  BillingClientSafeModeBanner,
  PlanChangePendingBanner,
  ReadOnlyPaywallBanner,
} from "../components/BillingShellBanners";
import Sidebar from "../components/Sidebar";
import Topbar from "../components/Topbar";
import PaddleAppInit from "../components/PaddleAppInit";
import PostCheckoutOnboardingModal from "../components/PostCheckoutOnboardingModal";
import { AppMainPaneRefProvider } from "../components/AppMainPaneRefContext";
import { BillingShellGate } from "../components/BillingShellGate";
import { supabase } from "../../lib/supabaseClient";

function SidebarFallback() {
  return (
    <div
      style={{
        minHeight: "100vh",
        width: 300,
        background: "rgba(255,255,255,0.02)",
        borderRight: "1px solid rgba(255,255,255,0.06)",
      }}
    />
  );
}

function TopbarFallback() {
  return (
    <div
      style={{
        height: 64,
        width: "100%",
        borderBottom: "1px solid rgba(255,255,255,0.08)",
        background: "rgba(11,11,16,0.75)",
      }}
    />
  );
}

export default function WithSidebarLayout({ children }: { children: React.ReactNode }) {
  const [email, setEmail] = useState<string>("");
  const mainRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    let mounted = true;

    (async () => {
      const { data } = await supabase.auth.getUser();
      if (!mounted) return;
      setEmail(data.user?.email ?? "");
    })();

    return () => {
      mounted = false;
    };
  }, []);

  return (
    <BillingBootstrapProvider>
      <BillingPricingModalProvider>
      <div
        className="app-shell-grid"
        style={{
          minHeight: "100vh",
          background: "#0b0b10",
          display: "grid",
          gridTemplateColumns: "260px 1fr",
        }}
      >
        <DevAbortRejectionSuppressor />
        <PaddleAppInit />
        <PostCheckoutOnboardingModal />
        {/* LEFT: SIDEBAR — 260px to match Sidebar component width; wrapped in Suspense because Sidebar uses useSearchParams() */}
        <div className="app-shell-sidebar" style={{ minHeight: "100vh", minWidth: 0 }}>
          <Suspense fallback={<SidebarFallback />}>
            <Sidebar />
          </Suspense>
        </div>

        {/* RIGHT: TOPBAR + CONTENT */}
        <div
          className="app-shell-main-stack"
          style={{
            minHeight: "100vh",
            display: "grid",
            gridTemplateRows: "auto 64px 1fr",
          }}
        >
          <div className="app-shell-banners" style={{ minWidth: 0 }}>
            <BillingClientSafeModeBanner />
            <BillingAccessStricterBanner />
            <PlanChangePendingBanner />
          </div>
          <div className="app-shell-topbar" style={{ height: 64 }}>
            <Suspense fallback={<TopbarFallback />}>
              <Topbar email={email} />
            </Suspense>
          </div>

          <main
            ref={mainRef}
            className="app-shell-main"
            style={{
              minHeight: 0,
              position: "relative",
              overflowX: "hidden",
              overflowY: "auto",
            }}
          >
            <AppMainPaneRefProvider mainRef={mainRef}>
              <ReadOnlyPaywallBanner />
              <BillingShellGate>{children}</BillingShellGate>
            </AppMainPaneRefProvider>
          </main>
        </div>
      </div>
      </BillingPricingModalProvider>
    </BillingBootstrapProvider>
  );
}

