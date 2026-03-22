import Link from "next/link";

import { BaseButton } from "@/components/landing/BaseButton";

export function LandingHeader() {
  return (
    <header className="sticky top-0 z-50">
      <div className="border-b border-white/8 bg-black/30 backdrop-blur-xl">
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-4 px-5 py-3">
          <Link href="/" className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl border border-white/10 bg-white/6 font-black">
              BIQ
            </div>
            <div className="leading-tight">
              <div className="text-sm font-extrabold text-white/95">BoardIQ</div>
              <div className="text-xs text-white/50">analytics</div>
            </div>
          </Link>

          <div className="flex items-center gap-2">
            <BaseButton href="/app/projects" variant="outline">
              Перейти в продукт
            </BaseButton>
            <BaseButton href="/login" variant="secondary">
              Вход
            </BaseButton>
          </div>
        </div>
      </div>
    </header>
  );
}
