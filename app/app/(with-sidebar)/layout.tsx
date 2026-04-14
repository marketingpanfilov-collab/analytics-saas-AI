"use client";

import { Suspense, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { usePathname } from "next/navigation";
import DevAbortRejectionSuppressor from "../components/DevAbortRejectionSuppressor";
import { BillingBootstrapProvider } from "../components/BillingBootstrapProvider";
import { BillingPricingModalProvider } from "../components/BillingPricingModalProvider";
import {
  BillingAccessStricterBanner,
  BillingClientSafeModeBanner,
  PlanChangePendingBanner,
  ReadOnlyPaywallBanner,
} from "../components/BillingShellBanners";
import { AppMobileNavProvider, useAppMobileNav } from "../components/AppMobileNavContext";
import Sidebar from "../components/Sidebar";
import Topbar from "../components/Topbar";
import AppMobileLandingNavDrawer from "../components/mobile/AppMobileLandingNavDrawer";
import MobileTabBar from "../components/mobile/MobileTabBar";
import MobileTodayDrawer from "../components/mobile/MobileTodayDrawer";
import PaddleAppInit from "../components/PaddleAppInit";
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

function WithSidebarShell({ children, email }: { children: ReactNode; email: string }) {
  const pathname = usePathname();
  const isSupportPage = pathname === "/app/support" || pathname?.startsWith("/app/support/");
  const mainRef = useRef<HTMLElement | null>(null);
  const { mobileNavOpen } = useAppMobileNav();

  useLayoutEffect(() => {
    if (typeof window === "undefined") return;
    if (isSupportPage) return;
    if (!window.matchMedia("(max-width: 1023px)").matches) return;
    window.scrollTo(0, 0);
    document.documentElement.scrollTop = 0;
    document.body.scrollTop = 0;
    const pane = mainRef.current?.querySelector(".app-shell-main-scroll");
    if (pane instanceof HTMLElement) pane.scrollTop = 0;
  }, [pathname, isSupportPage]);

  return (
    <>
      <div
        className="app-shell-grid"
        data-mobile-nav-open={mobileNavOpen ? "1" : "0"}
        data-support-mobile={isSupportPage ? "1" : "0"}
        style={{
          /* Вся оболочка привязана к viewport: 1fr у main не растёт с контентом; скролл — в колонке сайдбара и в main-scroll (кроме /app/support). */
          height: "100dvh",
          maxHeight: "100dvh",
          minHeight: "100dvh",
          overflow: "hidden",
          background: "#0b0b10",
          display: "grid",
          gridTemplateColumns: "260px 1fr",
        }}
      >
        <DevAbortRejectionSuppressor />
        <PaddleAppInit />
        {/* LEFT: SIDEBAR — 260px to match Sidebar component width; wrapped in Suspense because Sidebar uses useSearchParams() */}
        <div
          className="app-shell-sidebar"
          style={{
            minWidth: 0,
            minHeight: 0,
            height: "100%",
            maxHeight: "100dvh",
            overflowX: "hidden",
            overflowY: "auto",
            overscrollBehavior: "contain",
          }}
        >
          <Suspense fallback={<SidebarFallback />}>
            <Sidebar />
          </Suspense>
        </div>

        {/* RIGHT: TOPBAR + CONTENT */}
        <div
          className="app-shell-main-stack"
          style={{
            minHeight: 0,
            height: "100%",
            maxHeight: "100%",
            overflow: "hidden",
            display: "grid",
            gridTemplateRows: "auto 64px 1fr",
          }}
        >
          <div className="app-shell-mobile-header">
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
          </div>

          <main
            ref={mainRef}
            className="app-shell-main flex min-h-0 flex-col"
            style={{
              minHeight: 0,
              position: "relative",
              overflowX: "hidden",
              overflowY: "hidden",
            }}
          >
            <AppMainPaneRefProvider mainRef={mainRef}>
              <div className="shrink-0">
                <ReadOnlyPaywallBanner />
              </div>
              {/* Обычные страницы: вертикальный scroll здесь. /app/support — без scroll оболочки, только внутренние панели. */}
              <div
                className={
                  isSupportPage
                    ? "app-shell-main-scroll flex min-h-0 flex-1 flex-col overflow-x-hidden overflow-y-hidden pb-app-mobile-tabbar"
                    : "app-shell-main-scroll min-h-0 flex-1 overflow-x-hidden overflow-y-auto pb-app-mobile-tabbar"
                }
              >
                <BillingShellGate>{children}</BillingShellGate>
              </div>
            </AppMainPaneRefProvider>
          </main>
        </div>
      </div>
      <Suspense fallback={null}>
        <AppMobileLandingNavDrawer />
      </Suspense>
      <Suspense fallback={null}>
        <MobileTodayDrawer />
      </Suspense>
      <Suspense fallback={null}>
        <MobileTabBar />
      </Suspense>
    </>
  );
}

export default function WithSidebarLayout({ children }: { children: React.ReactNode }) {
  const [email, setEmail] = useState<string>("");

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
        <AppMobileNavProvider>
          <WithSidebarShell email={email}>{children}</WithSidebarShell>
        </AppMobileNavProvider>
      </BillingPricingModalProvider>
    </BillingBootstrapProvider>
  );
}
