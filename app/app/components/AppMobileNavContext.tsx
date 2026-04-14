"use client";

import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from "react";

type AppMobileNavContextValue = {
  mobileNavOpen: boolean;
  setMobileNavOpen: (open: boolean) => void;
  toggleMobileNav: () => void;
  todayDrawerOpen: boolean;
  setTodayDrawerOpen: (open: boolean) => void;
  todayDrawerPortalContainer: HTMLElement | null;
  setTodayDrawerPortalContainer: (el: HTMLElement | null) => void;
  /** Заголовок слева в шапке drawer «Сегодня» (название проекта). */
  todayDrawerProjectLabel: string | null;
  setTodayDrawerProjectLabel: (label: string | null) => void;
};

const AppMobileNavContext = createContext<AppMobileNavContextValue | null>(null);

export function AppMobileNavProvider({ children }: { children: ReactNode }) {
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const [todayDrawerOpen, setTodayDrawerOpen] = useState(false);
  const [todayDrawerPortalContainer, setTodayDrawerPortalContainer] = useState<HTMLElement | null>(null);
  const [todayDrawerProjectLabel, setTodayDrawerProjectLabel] = useState<string | null>(null);
  const toggleMobileNav = useCallback(() => setMobileNavOpen((o) => !o), []);

  const value = useMemo(
    () => ({
      mobileNavOpen,
      setMobileNavOpen,
      toggleMobileNav,
      todayDrawerOpen,
      setTodayDrawerOpen,
      todayDrawerPortalContainer,
      setTodayDrawerPortalContainer,
      todayDrawerProjectLabel,
      setTodayDrawerProjectLabel,
    }),
    [mobileNavOpen, todayDrawerOpen, todayDrawerPortalContainer, todayDrawerProjectLabel, toggleMobileNav]
  );

  return <AppMobileNavContext.Provider value={value}>{children}</AppMobileNavContext.Provider>;
}

export function useOptionalAppMobileNav(): AppMobileNavContextValue | null {
  return useContext(AppMobileNavContext);
}

export function useAppMobileNav(): AppMobileNavContextValue {
  const c = useContext(AppMobileNavContext);
  if (!c) throw new Error("useAppMobileNav must be used within AppMobileNavProvider");
  return c;
}
