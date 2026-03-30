"use client";

import { useEffect } from "react";
import { isAbortError } from "@/app/lib/abortUtils";

/**
 * Next.js dev overlay treats some fetch AbortSignal rejections as unhandled even when intentional.
 * Swallow only abort-shaped reasons so real bugs still surface.
 */
export default function DevAbortRejectionSuppressor() {
  useEffect(() => {
    if (process.env.NODE_ENV !== "development") return;
    const onUnhandled = (ev: PromiseRejectionEvent) => {
      if (isAbortError(ev.reason)) {
        ev.preventDefault();
      }
    };
    window.addEventListener("unhandledrejection", onUnhandled);
    return () => window.removeEventListener("unhandledrejection", onUnhandled);
  }, []);
  return null;
}
