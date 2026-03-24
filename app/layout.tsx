import type { Metadata } from "next";
import { Plus_Jakarta_Sans } from "next/font/google";
import "./globals.css";

const jakarta = Plus_Jakarta_Sans({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700", "800"],
  display: "swap",
  variable: "--font-jakarta",
});

export const metadata: Metadata = {
  metadataBase: new URL("https://boardiq.kz"),
  title: {
    default: "BoardIQ — Маркетинговая аналитика и DDA",
    template: "%s | BoardIQ",
  },
  description:
    "BoardIQ объединяет рекламные данные, атрибуцию DDA и управленческие рекомендации в единой аналитической платформе.",
  applicationName: "BoardIQ",
  keywords: [
    "BoardIQ",
    "маркетинговая аналитика",
    "атрибуция",
    "DDA",
    "сквозная аналитика",
    "рекламные отчеты",
    "SaaS аналитика",
  ],
  alternates: {
    canonical: "/",
  },
  icons: {
    icon: [{ url: "/icon.svg", type: "image/svg+xml" }],
    shortcut: ["/icon.svg"],
    apple: [{ url: "/icon.svg" }],
  },
  openGraph: {
    type: "website",
    url: "https://boardiq.kz",
    siteName: "BoardIQ",
    locale: "ru_RU",
    title: "BoardIQ — Маркетинговая аналитика и DDA",
    description:
      "Единая платформа для отчетности по рекламе: прозрачные данные, DDA-атрибуция и рекомендации для роста.",
    images: [
      {
        url: "/opengraph-image",
        width: 1200,
        height: 630,
        alt: "BoardIQ — маркетинговая аналитика",
      },
    ],
  },
  twitter: {
    card: "summary_large_image",
    title: "BoardIQ — Маркетинговая аналитика и DDA",
    description:
      "Прозрачные данные, DDA-атрибуция и управленческие рекомендации в одном месте.",
    images: ["/twitter-image"],
  },
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="ru" className={jakarta.variable}>
      <body className="min-h-screen text-white antialiased">
        {children}
      </body>
    </html>
  );
}