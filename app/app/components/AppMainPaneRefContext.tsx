"use client";

import { createContext, useContext, type ReactNode, type RefObject } from "react";

/** Ref на `<main>` в `(with-sidebar)/layout` — для оверлеев только над контентом, без сайдбара и топбара. */
const AppMainPaneRefContext = createContext<RefObject<HTMLElement | null> | null>(null);

export function AppMainPaneRefProvider({
  mainRef,
  children,
}: {
  mainRef: RefObject<HTMLElement | null>;
  children: ReactNode;
}) {
  return <AppMainPaneRefContext.Provider value={mainRef}>{children}</AppMainPaneRefContext.Provider>;
}

export function useAppMainPaneRef(): RefObject<HTMLElement | null> | null {
  return useContext(AppMainPaneRefContext);
}
