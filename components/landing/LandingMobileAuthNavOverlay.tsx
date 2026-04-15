"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";

type LandingMobileAuthNavOverlayContextValue = {
  /** Только при ширине &lt; md: затемняет экран до ухода со страницы. */
  startMobileAuthWait: () => void;
};

const LandingMobileAuthNavOverlayContext = createContext<LandingMobileAuthNavOverlayContextValue | null>(
  null
);

export function useLandingMobileAuthNavOverlay(): LandingMobileAuthNavOverlayContextValue | null {
  return useContext(LandingMobileAuthNavOverlayContext);
}

function useIsBelowMd() {
  const [below, setBelow] = useState(false);
  useEffect(() => {
    if (typeof window === "undefined") return;
    const mq = window.matchMedia("(max-width: 767px)");
    const sync = () => setBelow(mq.matches);
    sync();
    mq.addEventListener("change", sync);
    return () => mq.removeEventListener("change", sync);
  }, []);
  return below;
}

export function LandingMobileAuthNavOverlayProvider({ children }: { children: ReactNode }) {
  const isBelowMd = useIsBelowMd();
  const [open, setOpen] = useState(false);

  const startMobileAuthWait = useCallback(() => {
    if (isBelowMd) setOpen(true);
  }, [isBelowMd]);

  const value = useMemo(() => ({ startMobileAuthWait }), [startMobileAuthWait]);

  return (
    <LandingMobileAuthNavOverlayContext.Provider value={value}>
      {children}
      {open ? (
        <div
          className="fixed inset-0 z-[300] flex items-center justify-center bg-black/70 backdrop-blur-md md:hidden"
          role="status"
          aria-live="polite"
          aria-busy="true"
        >
          <p className="text-base font-medium text-zinc-400">Подождите...</p>
        </div>
      ) : null}
    </LandingMobileAuthNavOverlayContext.Provider>
  );
}
