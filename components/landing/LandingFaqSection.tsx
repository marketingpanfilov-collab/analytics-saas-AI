"use client";

import { useEffect, useId, useState, type ReactNode } from "react";

import { cn } from "@/components/landing/BaseButton";

type FaqItem = { question: string; answer: string };

type FaqSection = { title: string | null; items: FaqItem[] };

/** Текст FAQ: перечисления с маркерами, единообразная пунктуация. */
const FAQ_SECTIONS: FaqSection[] = [
  {
    title: null,
    items: [
      {
        question: "Кто мы?",
        answer:
          "BoardIQ Analytics — это SaaS-платформа управленческой аналитики для бизнеса.\nМы объединяем данные из рекламы, сайтов и CRM в единую систему, чтобы ты видел реальную картину: сколько зарабатываешь, сколько тратишь и где теряешь деньги.",
      },
      {
        question: "Наша методология",
        answer:
          "Мы используем сложные архитектурные и математические модели, чтобы показать тебе максимально точную картину бизнеса.\n\nВ основе:\n\n• Объединение данных из разных источников в единую модель;\n• Data-Driven Attribution (DDA);\n• Собственный трекинг и идентификация пользователей;\n• Анализ цепочек касаний и вклад каждого канала.\n\n👉 Мы не просто собираем данные — мы восстанавливаем реальную экономику бизнеса, убирая искажения.",
      },
      {
        question: "Почему наша аналитика прозрачная?",
        answer:
          "Мы не «пересчитываем» данные, как это делают рекламные кабинеты.\nBoardIQ показывает чистую экономику бизнеса, объединяя:\n\n• Расходы (Meta, Google, TikTok и др.);\n• Доходы (CRM, сайт, оплаты);\n• Реальные покупки и LTV.\n\n👉 Ты видишь не клики и лиды, а деньги, ROI и вклад каждого канала.",
      },
      {
        question: "В чем наше преимущество?",
        answer:
          "• Сквозная аналитика вместо разрозненных отчётов;\n• DDA вместо last-click;\n• Контроль качества данных;\n• Единый дашборд для собственника;\n• Система рекомендаций.\n\n👉 Это не просто аналитика — это система управления маркетингом через цифры.",
      },
    ],
  },
  {
    title: "Зачем это нужно",
    items: [
      {
        question: "Для чего мне нужна эта аналитика?",
        answer:
          "BoardIQ отвечает на ключевые вопросы бизнеса:\n\n• Какой канал приносит деньги, а не просто лиды;\n• На каком этапе воронки участвует канал и какова его реальная ценность;\n• Сколько касаний нужно до покупки;\n• Где теряются пользователи.\n\nДополнительно ты получаешь:\n\n• Отслеживание план/факт показателей;\n• Контроль юнит-экономики и финансовой модели;\n• Понимание окупаемости в разрезе каналов.\n\n👉 Это инструмент, который превращает маркетинг из «расхода» в управляемую систему прибыли.",
      },
      {
        question: "Насколько точные данные показывает BoardIQ?",
        answer:
          "Мы стремимся к максимально точной модели:\n\n• Собственный трекинг;\n• Объединение источников;\n• Учёт потерь данных.\n\n👉 Плюс есть оценка качества данных, чтобы ты понимал уровень доверия к цифрам.",
      },
      {
        question: "Чем вы лучше GA4 и рекламных кабинетов?",
        answer:
          "GA4 и рекламные кабинеты:\n\n• Показывают часть данных;\n• Не считают прибыль;\n• Искажают атрибуцию.\n\nBoardIQ:\n\n• Объединяет всё;\n• Считает деньги;\n• Показывает реальную эффективность.\n\n👉 Мы не заменяем — мы даём уровень выше.",
      },
      {
        question: "Подходит ли это для малого бизнеса?",
        answer:
          "Да.\n\nТы получаешь:\n\n• Контроль расходов;\n• Понимание окупаемости;\n• Точки роста.\n\n👉 Особенно важно, если бюджет ограничен.",
      },
      {
        question: "Можно ли масштабировать бизнес с помощью BoardIQ?",
        answer:
          "Да — и это одна из ключевых задач нашего продукта.\n\nBoardIQ помогает:\n\n• Находить точки роста;\n• Масштабировать прибыльные каналы;\n• Отключать неэффективные каналы.\n\nДополнительно:\n\n• Отслеживать план/факт финансовых показателей;\n• Контролировать рост бизнеса на уровне экономики.\n\n👉 Ты масштабируешься не на ощущениях, а на цифрах.",
      },
    ],
  },
  {
    title: "Настройка и интеграция",
    items: [
      {
        question: "Сколько времени занимает настройка?",
        answer:
          "В среднем:\n\n• Базовая настройка — 1–2 часа;\n• Полный запуск — до 1 дня.\n\nЕсли ты используешь серверную отправку событий (BQ Pixel):\n\n• Настройка может занять 1–2 дня;\n• Может потребоваться участие разработчиков.\n\n👉 Но это даёт максимальную точность данных.",
      },
      {
        question: "Мне нужны разработчики?",
        answer:
          "Зависит от твоей инфраструктуры:\n\n• Если работаешь только с CRM — разработчики не нужны;\n• Если есть сайт и онлайн-оплаты — рекомендуется подключение разработчиков.\n\nОни помогут:\n\n• Внедрить BQ Pixel;\n• Настроить отправку событий (покупки, лиды и т. д.);\n• Обеспечить корректный трекинг.",
      },
      {
        question: "Как часто обновляются данные?",
        answer:
          "• Обновление — почти в реальном времени;\n• Полная синхронизация — каждые 10–20 минут.\n\n👉 Ты всегда видишь актуальную картину бизнеса.",
      },
    ],
  },
  {
    title: "Тарифы и проекты",
    items: [
      {
        question: "У меня несколько направлений (B2B / B2C). Какой тариф выбрать?",
        answer:
          "Рекомендуем разделять направления.\n\nЕсли у тебя несколько направлений:\n\n• Создавай отдельные проекты;\n• Используй отдельные рекламные кабинеты (чтобы не смешивать расходы).\n\n👉 Подойдут тарифы:\n\n• Growth;\n• Agency.\n\nЕсли одно направление:\n\n• Один проект (B2B или B2C).\n\n👉 Подойдёт:\n\n• Starter.",
      },
    ],
  },
  {
    title: "Поддержка",
    items: [
      {
        question: "Могу ли я заказать внедрение у вас?",
        answer:
          "Да.\n\nЧтобы заказать внедрение:\n\n• Обратись в раздел «Поддержка» внутри платформы;\n• Или напиши на почту: support@boardiq.kz.\n\nМы можем:\n\n• Настроить систему под ключ;\n• Подключить все источники;\n• Выстроить аналитику;\n• Обучить команду.",
      },
      {
        question: "Что делать, если возникли проблемы?",
        answer:
          "Ты всегда можешь рассчитывать на поддержку:\n\n• Чат внутри системы;\n• Помощь с настройкой;\n• Диагностика данных;\n• Сопровождение.\n\n👉 Мы не просто даём инструмент — мы помогаем им пользоваться.",
      },
    ],
  },
];

function itemId(sectionIndex: number, itemIndex: number) {
  return `faq-${sectionIndex}-${itemIndex}`;
}

/** Парсит ответ: абзацы как <p>, блоки «• …» — список с выровненным по строке маркером. */
function FaqAnswerBody({ text }: { text: string }) {
  const lines = text.split("\n");
  const out: ReactNode[] = [];
  let i = 0;

  const flushParagraph = (start: number, end: number) => {
    if (start >= end) return;
    const chunk = lines.slice(start, end).join("\n").replace(/\s+$/, "");
    if (!chunk.trim()) return;
    out.push(
      <p key={`p-${out.length}`} className="mb-3 whitespace-pre-line leading-relaxed last:mb-0">
        {chunk}
      </p>
    );
  };

  while (i < lines.length) {
    const raw = lines[i] ?? "";
    if (raw.trim() === "") {
      i++;
      continue;
    }
    if (/^\s*•\s?/.test(raw)) {
      const items: string[] = [];
      while (i < lines.length) {
        const line = lines[i] ?? "";
        const m = /^\s*•\s*(.*)$/.exec(line);
        if (!m) break;
        items.push(m[1] ?? "");
        i++;
      }
      out.push(
        <ul key={`ul-${out.length}`} className="mb-3 list-none space-y-2.5 last:mb-0">
          {items.map((content, j) => (
            <li
              key={j}
              className="grid items-start gap-x-2.5 [grid-template-columns:1rem_minmax(0,1fr)] sm:[grid-template-columns:1.125rem_minmax(0,1fr)]"
            >
              <span
                className="flex min-h-[1.2em] h-[1lh] items-center justify-center text-[0.92em] leading-none text-white/65"
                aria-hidden
              >
                •
              </span>
              <span className="min-w-0 leading-relaxed">{content}</span>
            </li>
          ))}
        </ul>
      );
      continue;
    }
    const paraStart = i;
    while (i < lines.length) {
      const L = lines[i] ?? "";
      if (L.trim() === "") break;
      if (/^\s*•\s?/.test(L)) break;
      i++;
    }
    flushParagraph(paraStart, i);
  }

  return <div>{out}</div>;
}

function Chevron({ open, reducedMotion }: { open: boolean; reducedMotion: boolean }) {
  return (
    <span
      className={cn(
        "inline-flex h-8 w-8 shrink-0 items-center justify-center self-center rounded-lg border border-white/10 bg-white/[0.04] text-white/55 transition-[transform,background-color,border-color,color]",
        !reducedMotion && "duration-300 ease-out",
        open && "rotate-180 border-emerald-400/25 bg-emerald-500/[0.08] text-emerald-100/90"
      )}
      aria-hidden
    >
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M6 9l6 6 6-6" />
      </svg>
    </span>
  );
}

export function LandingFaqSection() {
  const baseId = useId();
  /** Только один открытый пункт — страница не растягивается по высоте. */
  const [openId, setOpenId] = useState<string | null>(null);
  const [reducedMotion, setReducedMotion] = useState(false);

  useEffect(() => {
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    setReducedMotion(mq.matches);
    const h = () => setReducedMotion(mq.matches);
    mq.addEventListener("change", h);
    return () => mq.removeEventListener("change", h);
  }, []);

  const toggle = (id: string) => {
    setOpenId((prev) => (prev === id ? null : id));
  };

  const dur = reducedMotion ? "duration-0" : "duration-300";

  return (
    <section
      id="faq"
      className="landing-mid-scope relative z-10 scroll-mt-28 border-t border-white/10 py-14 md:py-20 md:scroll-mt-32"
      aria-labelledby={`${baseId}-heading`}
    >
      <div className="mx-auto max-w-6xl px-5">
        <h2 id={`${baseId}-heading`} className="text-center text-3xl font-semibold tracking-tight text-white/95 md:text-4xl">
          FAQ
        </h2>

        <div className="mt-10 space-y-12 md:mt-12 md:space-y-14">
          {FAQ_SECTIONS.map((section, sIdx) => (
            <div key={sIdx}>
              {section.title ? (
                <h3 className="mb-5 text-xs font-semibold uppercase tracking-[0.2em] text-emerald-400/85 md:mb-6 md:text-sm">
                  {section.title}
                </h3>
              ) : null}
              <div className="space-y-2 md:space-y-2.5">
                {section.items.map((item, iIdx) => {
                  const id = itemId(sIdx, iIdx);
                  const panelId = `${baseId}-${id}-panel`;
                  const buttonId = `${baseId}-${id}-btn`;
                  const open = openId === id;

                  return (
                    <div
                      key={id}
                      className="overflow-hidden rounded-xl border border-white/[0.08] bg-white/[0.025] shadow-[0_12px_40px_rgba(0,0,0,0.2)] transition-[border-color,box-shadow] duration-300 ease-out hover:border-white/[0.12]"
                    >
                      <button
                        id={buttonId}
                        type="button"
                        aria-expanded={open}
                        aria-controls={panelId}
                        onClick={() => toggle(id)}
                        className={cn(
                          "flex w-full items-center gap-3 px-4 py-3.5 text-left md:gap-4 md:px-5 md:py-4",
                          "transition-[background-color] ease-out",
                          dur,
                          "hover:bg-white/[0.04] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400/35 focus-visible:ring-offset-2 focus-visible:ring-offset-[#030303]"
                        )}
                      >
                        <span className="min-w-0 flex-1 text-[15px] font-semibold leading-snug text-white/92 md:text-base">
                          {item.question}
                        </span>
                        <Chevron open={open} reducedMotion={reducedMotion} />
                      </button>

                      <div
                        className={cn(
                          "grid transition-[grid-template-rows] ease-out",
                          dur,
                          open ? "grid-rows-[1fr]" : "grid-rows-[0fr]"
                        )}
                      >
                        <div className="min-h-0 overflow-hidden">
                          <div
                            id={panelId}
                            role="region"
                            aria-labelledby={buttonId}
                            aria-hidden={!open}
                            className={cn(
                              "border-t border-white/[0.06] px-4 pb-4 pt-3 md:px-5 md:pb-5 md:pt-3.5",
                              "text-sm leading-relaxed text-white/65 transition-opacity ease-out md:text-[15px]",
                              dur,
                              open ? "opacity-100" : "pointer-events-none opacity-0"
                            )}
                          >
                            <FaqAnswerBody text={item.answer} />
                          </div>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
