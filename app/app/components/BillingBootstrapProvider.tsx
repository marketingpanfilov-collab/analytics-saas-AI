"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { usePathname, useRouter } from "next/navigation";
import { ReasonCode, ScreenId, type ResolvedUiStateV1 } from "@/app/lib/billingUiContract";
import {
  BILLING_BC_NAME,
  BILLING_BOOTSTRAP_RETRY_DELAYS_MS,
  BILLING_STABILIZATION_WINDOW_MS,
  blockingLevelRank,
  broadcastBillingBootstrapInvalidate,
  type BillingBootstrapApiOk,
  clearBillingRouteStorage,
  fingerprintResolvedUi,
  isBootstrapResponseValid,
  makeSafeFallbackResolvedUi,
  capResolvedUiNeverExpand,
  MAX_SHELL_REDIRECT_DEPTH,
  newBootstrapRequestId,
  normalizeBillingFeatureFlags,
  readLastKnownBootstrap,
  readStoredIntendedRoute,
  routeAllowedByResolved,
  setShellRedirectDepth,
  shouldApplyResolvedImmediately,
  storeIntendedRoute,
  validateIntendedRoute,
  writeLastKnownBootstrap,
  bumpShellRedirectDepth,
} from "@/app/lib/billingBootstrapClient";
import type { PlanFeatureMatrix } from "@/app/lib/planConfig";
import { supabase } from "@/app/lib/supabaseClient";

export type BillingBootstrapContextValue = {
  /** Stabilized shell state from server; do not branch shell on other bootstrap fields (P0-CON-03). */
  resolvedUi: ResolvedUiStateV1 | null;
  bootstrap: BillingBootstrapApiOk | null;
  loading: boolean;
  clientSafeMode: boolean;
  /** Single-flight: concurrent calls await the same in-flight fetch; resolves with applied `resolved_ui_state`. */
  reloadBootstrap: () => Promise<ResolvedUiStateV1 | null>;
  showPostCheckoutModal: boolean;
  planFeatureMatrix: PlanFeatureMatrix | undefined;
};

const BillingBootstrapContext = createContext<BillingBootstrapContextValue | null>(null);

export function useBillingBootstrap(): BillingBootstrapContextValue {
  const ctx = useContext(BillingBootstrapContext);
  if (!ctx) {
    throw new Error("useBillingBootstrap must be used within BillingBootstrapProvider");
  }
  return ctx;
}

async function fetchBootstrapOnce(requestId: string): Promise<BillingBootstrapApiOk | null> {
  const res = await fetch("/api/billing/current-plan", {
    credentials: "include",
    cache: "no-store",
    headers: { "x-request-id": requestId },
  });
  const json: unknown = await res.json().catch(() => null);
  if (!res.ok || !isBootstrapResponseValid(json)) return null;
  return json;
}

export function BillingBootstrapProvider({ children }: { children: ReactNode }) {
  const router = useRouter();
  const pathname = usePathname() ?? "";

  const [bootstrap, setBootstrap] = useState<BillingBootstrapApiOk | null>(null);
  const [displayedResolved, setDisplayedResolved] = useState<ResolvedUiStateV1 | null>(null);
  const [loading, setLoading] = useState(true);
  const [clientSafeMode, setClientSafeMode] = useState(false);

  const prevFetchFpRef = useRef<string | null>(null);
  const consecutiveSuccessOutOfSafeRef = useRef(0);
  const clientSafeModeRef = useRef(false);
  const stabilizationTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const stabilizationPendingRef = useRef<ResolvedUiStateV1 | null>(null);
  const lastBootstrapApplyAtRef = useRef(0);
  const lastBootstrapFpRef = useRef<string | null>(null);
  const prevSuccessBootstrapFpRef = useRef<string | null>(null);
  const clientLogDedupRef = useRef<{ fp: string; ts: number }>({ fp: "", ts: 0 });
  const bootstrapInflightRef = useRef<Promise<ResolvedUiStateV1 | null> | null>(null);
  const lastAuthUserIdRef = useRef<string | null>(null);

  useEffect(() => {
    clientSafeModeRef.current = clientSafeMode;
  }, [clientSafeMode]);

  useEffect(() => {
    const { data: sub } = supabase.auth.onAuthStateChange((event, session) => {
      if (event === "SIGNED_OUT") {
        clearBillingRouteStorage();
        lastAuthUserIdRef.current = null;
        return;
      }
      const uid = session?.user?.id ?? null;
      if (lastAuthUserIdRef.current !== null && uid !== null && lastAuthUserIdRef.current !== uid) {
        clearBillingRouteStorage();
      }
      lastAuthUserIdRef.current = uid;
    });
    void supabase.auth.getUser().then(({ data }) => {
      lastAuthUserIdRef.current = data.user?.id ?? null;
    });
    return () => sub.subscription.unsubscribe();
  }, []);

  const applyResolvedToDisplay = useCallback((incoming: ResolvedUiStateV1) => {
    if (shouldApplyResolvedImmediately(incoming.reason)) {
      setDisplayedResolved(incoming);
      prevFetchFpRef.current = fingerprintResolvedUi(incoming);
      return;
    }
    setDisplayedResolved((current) => {
      if (!current) {
        prevFetchFpRef.current = fingerprintResolvedUi(incoming);
        return incoming;
      }
      const ifp = fingerprintResolvedUi(incoming);
      const cfp = fingerprintResolvedUi(current);
      if (ifp === cfp) {
        prevFetchFpRef.current = ifp;
        return current;
      }
      const incR = blockingLevelRank(incoming.blocking_level);
      const curR = blockingLevelRank(current.blocking_level);
      if (incR < curR) {
        prevFetchFpRef.current = cfp;
        return current;
      }
      const prevFp = prevFetchFpRef.current;
      prevFetchFpRef.current = ifp;
      if (prevFp === ifp) {
        return incoming;
      }
      return current;
    });
  }, []);

  const scheduleIncomingResolved = useCallback(
    (incoming: ResolvedUiStateV1 | null) => {
      if (!incoming) return;
      if (shouldApplyResolvedImmediately(incoming.reason)) {
        if (stabilizationTimerRef.current) {
          clearTimeout(stabilizationTimerRef.current);
          stabilizationTimerRef.current = null;
        }
        stabilizationPendingRef.current = null;
        applyResolvedToDisplay(incoming);
        return;
      }
      stabilizationPendingRef.current = incoming;
      if (stabilizationTimerRef.current) clearTimeout(stabilizationTimerRef.current);
      stabilizationTimerRef.current = setTimeout(() => {
        stabilizationTimerRef.current = null;
        const inc = stabilizationPendingRef.current;
        stabilizationPendingRef.current = null;
        if (inc) applyResolvedToDisplay(inc);
      }, BILLING_STABILIZATION_WINDOW_MS);
    },
    [applyResolvedToDisplay]
  );

  const runBootstrap = useCallback(async (): Promise<ResolvedUiStateV1 | null> => {
    setLoading(true);
    const requestId = newBootstrapRequestId();
    let result: BillingBootstrapApiOk | null = await fetchBootstrapOnce(requestId);
    if (!result) {
      for (const delay of BILLING_BOOTSTRAP_RETRY_DELAYS_MS) {
        await new Promise((r) => setTimeout(r, delay));
        result = await fetchBootstrapOnce(requestId);
        if (result) break;
      }
    }

    if (result) {
      const normalized: BillingBootstrapApiOk = {
        ...result,
        feature_flags: normalizeBillingFeatureFlags(result.feature_flags),
      };
      const fp = fingerprintResolvedUi(normalized.resolved_ui_state);
      if (
        prevSuccessBootstrapFpRef.current !== null &&
        prevSuccessBootstrapFpRef.current !== fp
      ) {
        broadcastBillingBootstrapInvalidate();
      }
      prevSuccessBootstrapFpRef.current = fp;

      writeLastKnownBootstrap(normalized);
      setBootstrap(normalized);
      lastBootstrapApplyAtRef.current = Date.now();
      lastBootstrapFpRef.current = fp;
      scheduleIncomingResolved(normalized.resolved_ui_state);
      if (clientSafeModeRef.current) {
        consecutiveSuccessOutOfSafeRef.current += 1;
        if (consecutiveSuccessOutOfSafeRef.current >= 2) {
          setClientSafeMode(false);
          consecutiveSuccessOutOfSafeRef.current = 0;
        }
      } else {
        consecutiveSuccessOutOfSafeRef.current = 0;
      }
      setLoading(false);
      return normalized.resolved_ui_state;
    }

    const last = readLastKnownBootstrap();
    if (last) {
      const rid = newBootstrapRequestId();
      const capped = capResolvedUiNeverExpand(last.resolved_ui_state, rid);
      const merged: BillingBootstrapApiOk = {
        ...last,
        request_id: rid,
        resolved_ui_state: capped,
        feature_flags: normalizeBillingFeatureFlags(last.feature_flags),
      };
      setBootstrap(merged);
      lastBootstrapApplyAtRef.current = Date.now();
      lastBootstrapFpRef.current = fingerprintResolvedUi(capped);
      scheduleIncomingResolved(capped);
      setClientSafeMode(true);
      setLoading(false);
      console.warn("[BILLING_BOOTSTRAP_FALLBACK]", {
        request_id: rid,
        client_safe_mode: true,
        used_last_known: true,
      });
      return capped;
    }

    const rid = newBootstrapRequestId();
    const fallback = makeSafeFallbackResolvedUi(rid);
    setBootstrap(null);
    lastBootstrapApplyAtRef.current = Date.now();
    lastBootstrapFpRef.current = fingerprintResolvedUi(fallback);
    scheduleIncomingResolved(fallback);
    setClientSafeMode(true);
    consecutiveSuccessOutOfSafeRef.current = 0;
    setLoading(false);
    console.warn("[BILLING_BOOTSTRAP_FALLBACK]", {
      request_id: rid,
      client_safe_mode: true,
      used_last_known: false,
    });
    return fallback;
  }, [scheduleIncomingResolved]);

  const runBootstrapRef = useRef(runBootstrap);
  runBootstrapRef.current = runBootstrap;

  useEffect(() => {
    void runBootstrapRef.current();
  }, []);

  useEffect(() => {
    if (typeof BroadcastChannel === "undefined") return;
    const ch = new BroadcastChannel(BILLING_BC_NAME);
    ch.onmessage = (ev: MessageEvent<{ type?: string }>) => {
      if (ev.data?.type === "invalidate") void runBootstrapRef.current();
    };
    return () => ch.close();
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const sp = new URLSearchParams(window.location.search);
    const v = validateIntendedRoute(sp.get("intended_route"));
    if (v) storeIntendedRoute(v);
  }, [pathname]);

  useEffect(() => {
    if (!displayedResolved || loading) return;
    if (displayedResolved.reason === ReasonCode.POST_CHECKOUT_REQUIRED) return;
    if (displayedResolved.reason === ReasonCode.BOOTSTRAP_UNAVAILABLE) return;
    if (displayedResolved.blocking_level === "hard") {
      const r = displayedResolved.reason;
      if (r !== ReasonCode.PLAN_CHANGE_PENDING) return;
    }
    const target = readStoredIntendedRoute();
    if (!target || target === pathname) return;
    if (!routeAllowedByResolved(target, displayedResolved)) {
      storeIntendedRoute(null);
      return;
    }
    const d = bumpShellRedirectDepth();
    if (d > MAX_SHELL_REDIRECT_DEPTH) {
      console.warn("[BILLING_SHELL_REDIRECT_CAP]", {
        depth: d,
        request_id: displayedResolved.request_id,
        pathname,
        intended: target,
      });
      setShellRedirectDepth(0);
      storeIntendedRoute(null);
      return;
    }
    storeIntendedRoute(null);
    router.replace(target);
  }, [displayedResolved, loading, pathname, router]);

  const reloadBootstrap = useCallback((): Promise<ResolvedUiStateV1 | null> => {
    if (bootstrapInflightRef.current) return bootstrapInflightRef.current;
    const p = runBootstrap().finally(() => {
      bootstrapInflightRef.current = null;
    });
    bootstrapInflightRef.current = p;
    return p;
  }, [runBootstrap]);

  useEffect(() => {
    if (!displayedResolved || loading) return;
    const fp = fingerprintResolvedUi(displayedResolved);
    const now = Date.now();
    if (
      fp === lastBootstrapFpRef.current &&
      now - lastBootstrapApplyAtRef.current < 2500
    ) {
      return;
    }
    if (fp === clientLogDedupRef.current.fp && now - clientLogDedupRef.current.ts < 4000) {
      return;
    }
    clientLogDedupRef.current = { fp, ts: now };
    void fetch("/api/billing/ui-transition", {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        next_screen: displayedResolved.screen,
        next_reason: displayedResolved.reason,
        request_id: displayedResolved.request_id,
        source: "client_shell",
        primary_org_id: bootstrap?.primary_org_id ?? null,
      }),
    }).catch(() => null);
  }, [displayedResolved, loading, bootstrap?.primary_org_id]);

  const value = useMemo<BillingBootstrapContextValue>(
    () => ({
      resolvedUi: displayedResolved,
      bootstrap,
      loading,
      clientSafeMode,
      reloadBootstrap,
      showPostCheckoutModal:
        displayedResolved?.screen === ScreenId.POST_CHECKOUT_MODAL &&
        displayedResolved?.reason === ReasonCode.POST_CHECKOUT_REQUIRED,
      planFeatureMatrix: bootstrap?.plan_feature_matrix,
    }),
    [displayedResolved, bootstrap, loading, clientSafeMode, reloadBootstrap]
  );

  return <BillingBootstrapContext.Provider value={value}>{children}</BillingBootstrapContext.Provider>;
}
