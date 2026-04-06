"use client";

import Script from "next/script";
import { usePathname } from "next/navigation";
import { useEffect, useRef } from "react";

/**
 * Инициализация Meta Pixel один раз + PageView при SPA-навигации.
 */
export default function MetaPixelRoot({ pixelId }: { pixelId: string }) {
  const pathname = usePathname();
  const firstPathRef = useRef(true);

  useEffect(() => {
    if (typeof window === "undefined" || !window.fbq) return;
    if (firstPathRef.current) {
      firstPathRef.current = false;
      return;
    }
    window.fbq("track", "PageView");
  }, [pathname]);

  if (!pixelId) return null;

  return (
    <Script
      id="meta-pixel-base"
      strategy="afterInteractive"
      dangerouslySetInnerHTML={{
        __html: `
!function(f,b,e,v,n,t,s){if(f.fbq)return;n=f.fbq=function(){n.callMethod?
n.callMethod.apply(n,arguments):n.queue.push(arguments)};if(!f._fbq)f._fbq=n;
n.push=n;n.loaded=!0;n.version='2.0';n.queue=[];t=b.createElement(e);t.async=!0;
t.src=v;s=b.getElementsByTagName(e)[0];s.parentNode.insertBefore(t,s)}(window,document,'script',
'https://connect.facebook.net/en_US/fbevents.js');
if(!window.__BOARDIQ_FB_PIXEL_INIT__){
  window.__BOARDIQ_FB_PIXEL_INIT__=true;
  fbq('init','${pixelId.replace(/'/g, "\\'")}');
  fbq('track','PageView');
}
        `.trim(),
      }}
    />
  );
}
