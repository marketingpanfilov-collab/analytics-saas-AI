"use client";

import { useEffect, useState, type RefObject } from "react";

const NARROW_QUERY = "(max-width: 1023px)";

/** Совпадает с `lg:` брейкпоинтом приложения: узкая ширина — тултипы через tap, без «hover / удержание». */
export function useNarrowViewportForTooltip(): boolean {
  const [narrow, setNarrow] = useState(false);
  useEffect(() => {
    if (typeof window === "undefined") return;
    const mq = window.matchMedia(NARROW_QUERY);
    const sync = () => setNarrow(mq.matches);
    sync();
    mq.addEventListener("change", sync);
    return () => mq.removeEventListener("change", sync);
  }, []);
  return narrow;
}

/** Закрыть тултип по tap вне `rootRef` (capture: раньше дочерних обработчиков). */
export function useDismissTooltipOnOutsidePointer(
  active: boolean,
  rootRef: RefObject<HTMLElement | null>,
  onDismiss: () => void
): void {
  useEffect(() => {
    if (!active) return;
    const onDoc = (ev: PointerEvent) => {
      const t = ev.target as Node | null;
      if (rootRef.current?.contains(t)) return;
      onDismiss();
    };
    document.addEventListener("pointerdown", onDoc, true);
    return () => document.removeEventListener("pointerdown", onDoc, true);
  }, [active, onDismiss, rootRef]);
}
