"use client";

import { useCallback, useEffect, useId, useRef, useState } from "react";

import { cn } from "@/components/landing/BaseButton";

const STEPS = [
  {
    step: "1",
    title: "Подключите источники трафика",
    body:
      "Подключите рекламные кабинеты (Meta, Google, TikTok), чтобы видеть расходы и данные по кампаниям",
    timeLabel: "От 5 минут",
  },
  {
    step: "2",
    title: "Передавайте данные о действиях пользователей",
    body: "Передавайте заявки, покупки и другие события из CRM или через server-side интеграцию",
    timeLabel: "От 10 минут",
  },
  {
    step: "3",
    title: "Настройте отслеживание и Pixel",
    body: "Разместите Pixel на сайте и используйте tracking-ссылки в рекламных кампаниях",
    timeLabel: "От 10 минут",
  },
  {
    step: "4",
    title: "Получите полную картину по рекламе и продажам",
    body:
      "Анализируйте эффективность каналов, расходы и выручку и принимайте решения на основе данных",
    timeLabel: "1–2 минуты",
  },
] as const;

/** 3.5–4 с между авто-шагами */
const AUTO_INTERVAL_MS = 3800;
/** Пауза авто-режима после ручного выбора */
const MANUAL_PAUSE_MS = 9000;

export function LandingHowItWorksSection() {
  const baseId = useId();
  const [active, setActive] = useState(0);
  const pauseUntilRef = useRef(0);
  const [reducedMotion, setReducedMotion] = useState(false);

  useEffect(() => {
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    const sync = () => setReducedMotion(mq.matches);
    sync();
    mq.addEventListener("change", sync);
    return () => mq.removeEventListener("change", sync);
  }, []);

  useEffect(() => {
    if (reducedMotion) return;
    const id = window.setInterval(() => {
      if (Date.now() < pauseUntilRef.current) return;
      setActive((i) => (i + 1) % STEPS.length);
    }, AUTO_INTERVAL_MS);
    return () => window.clearInterval(id);
  }, [reducedMotion]);

  const selectStep = useCallback((idx: number) => {
    setActive(idx);
    pauseUntilRef.current = Date.now() + MANUAL_PAUSE_MS;
  }, []);

  return (
    <section
      id="how-it-works"
      className="landing-mid-scope relative z-10 scroll-mt-24 border-t border-white/10"
      aria-labelledby={`${baseId}-heading`}
    >
      <div className="mx-auto max-w-6xl px-5 py-14 md:py-20">
        <h2
          id={`${baseId}-heading`}
          className="text-center text-3xl font-semibold tracking-tight text-white/95 md:text-4xl"
        >
          Как это работает
        </h2>
        <p className="mx-auto mt-4 max-w-2xl text-center text-base leading-relaxed text-white/55 md:text-lg">
          Подключите данные и получите первые выводы о рекламе и продажах в одном месте
        </p>

        <div
          className="mt-10 overflow-hidden rounded-2xl border border-white/10 bg-white/[0.025] ring-1 ring-white/[0.06]"
          role="list"
          aria-label="Шаги подключения"
        >
          {STEPS.map((row, i) => {
            const isActive = active === i;
            const panelId = `${baseId}-panel-${i}`;
            const titleId = `${baseId}-step-title-${i}`;

            return (
              <div
                key={row.step}
                role="listitem"
                className={cn(
                  "border-b border-white/[0.08] transition-[background-color,box-shadow] duration-300 ease-out last:border-b-0",
                  isActive
                    ? "bg-emerald-500/[0.08] shadow-[inset_0_0_0_1px_rgba(52,211,153,0.12)]"
                    : "bg-transparent hover:bg-white/[0.02]"
                )}
              >
                <button
                  type="button"
                  aria-expanded={isActive}
                  aria-controls={panelId}
                  onClick={() => selectStep(i)}
                  className={cn(
                    "flex w-full cursor-pointer items-start gap-3 px-4 py-3.5 text-left transition-[padding] duration-300 ease-out md:gap-4 md:px-6 md:py-4",
                    "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400/40 focus-visible:ring-offset-2 focus-visible:ring-offset-[#030303]",
                    isActive && "pb-2 md:pb-3 md:pt-5"
                  )}
                >
                  <span
                    className={cn(
                      "mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-full border text-sm font-extrabold transition-[border-color,background-color,color,box-shadow] duration-300 ease-out",
                      isActive
                        ? "border-emerald-400/45 bg-emerald-500/[0.2] text-emerald-100 shadow-[0_0_20px_rgba(52,211,153,0.12)]"
                        : "border-white/15 bg-white/[0.04] text-white/70"
                    )}
                    aria-hidden
                  >
                    {row.step}
                  </span>

                  <span className="min-w-0 flex-1">
                    <span className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between sm:gap-4">
                      <span
                        id={titleId}
                        className={cn(
                          "block text-base font-semibold leading-snug transition-colors duration-300 md:text-lg",
                          isActive ? "text-white/95" : "text-white/80"
                        )}
                      >
                        {row.title}
                      </span>
                      <span
                        className={cn(
                          "inline-flex w-fit shrink-0 rounded-full border px-2.5 py-1 text-[11px] font-medium transition-[border-color,background-color,color] duration-300 sm:mt-0.5 sm:text-xs",
                          isActive
                            ? "border-emerald-400/35 bg-emerald-500/[0.12] text-emerald-100/95"
                            : "border-white/12 bg-white/[0.05] text-white/50"
                        )}
                      >
                        {row.timeLabel}
                      </span>
                    </span>
                  </span>
                </button>

                <div
                  id={panelId}
                  role="region"
                  aria-labelledby={titleId}
                  className={cn(
                    "grid px-4 transition-[grid-template-rows] ease-out md:px-6",
                    "pl-[calc(1rem+2.25rem+0.75rem)] md:pl-[calc(1.5rem+2.25rem+1rem)]",
                    reducedMotion ? "duration-0" : "duration-300",
                    isActive ? "grid-rows-[1fr]" : "grid-rows-[0fr]"
                  )}
                >
                  <div className="min-h-0 overflow-hidden" aria-hidden={!isActive}>
                    <p
                      className={cn(
                        "pb-3.5 text-sm leading-relaxed text-white/60 ease-out md:pb-5 md:pr-2",
                        reducedMotion ? "duration-0" : "duration-300 transition-opacity",
                        isActive ? "opacity-100" : "opacity-0"
                      )}
                    >
                      {row.body}
                    </p>
                  </div>
                </div>
              </div>
            );
          })}
        </div>

      </div>
    </section>
  );
}
