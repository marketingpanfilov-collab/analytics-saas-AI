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
  title: "BoardIQ — Analytics",
  description: "Прозрачные данные, DDA и управленческие рекомендации",
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