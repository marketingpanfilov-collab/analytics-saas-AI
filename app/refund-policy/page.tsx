import Link from "next/link";

import { LandingHeader } from "@/components/layout/LandingHeader";
import { RequisitesBlock } from "@/components/legal/RequisitesBlock";
import { RefundRequestForm } from "@/components/legal/RefundRequestForm";

const p = "text-sm leading-relaxed text-white/60";
const h2 = "mb-3 mt-8 text-lg font-semibold text-white/95 first:mt-0";
const ul = "list-disc space-y-1.5 pl-5 text-sm leading-relaxed text-white/60";

export default function RefundPolicyPage() {
  return (
    <main className="relative min-h-screen overflow-hidden bg-[#030303] text-white">
      <div className="pointer-events-none absolute inset-0">
        <div className="hero-orb hero-orb-1" />
        <div className="hero-orb hero-orb-2" />
        <div className="hero-orb hero-orb-3" />
        <div className="hero-noise" />
        <div className="absolute inset-0 bg-[linear-gradient(to_bottom,rgba(255,255,255,0.03)_1px,transparent_1px),linear-gradient(to_right,rgba(255,255,255,0.03)_1px,transparent_1px)] bg-[size:88px_88px] opacity-[0.08]" />
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_center,transparent_0%,rgba(3,3,3,0.08)_55%,rgba(3,3,3,0.42)_100%)]" />
      </div>

      <LandingHeader />

      <section className="relative z-10">
        <div className="mx-auto max-w-5xl px-5 pb-16 pt-12 md:pb-20 md:pt-16">
          <p className="text-xs font-bold uppercase tracking-[0.22em] text-white/45">Юридическая информация</p>
          <h1 className="mt-3 text-3xl font-extrabold leading-tight text-white md:text-4xl">Политика возврата</h1>
          <p className="mt-4 max-w-2xl text-base leading-relaxed text-white/58">
            Настоящая Политика регулирует порядок возврата денежных средств по услугам BoardIQ и применяется с учетом
            требований законодательства Республики Казахстан.
          </p>

          <div className="mt-10 rounded-[28px] border border-white/10 bg-white/[0.04] p-6 backdrop-blur-md md:p-8">
            <h2 className={h2}>1. Общие положения</h2>
            <p className={p}>
              1.1. Политика возврата определяет условия, основания, сроки и порядок рассмотрения обращений Пользователей
              о возврате оплаты за доступ к сервису BoardIQ.
            </p>
            <p className={p}>
              1.2. При рассмотрении обращений Исполнитель руководствуется Гражданским кодексом Республики Казахстан,
              Законом Республики Казахстан "О защите прав потребителей" и иными применимыми нормами права.
            </p>
            <p className={p}>
              1.3. Политика применяется совместно с{" "}
              <Link className="text-white/80 underline underline-offset-2 hover:text-white" href="/terms">
                Пользовательским соглашением
              </Link>{" "}
              и{" "}
              <Link className="text-white/80 underline underline-offset-2 hover:text-white" href="/privacy">
                Политикой конфиденциальности
              </Link>
              .
            </p>

            <h2 className={h2}>2. Когда возврат возможен</h2>
            <ul className={ul}>
              <li>двойное списание или ошибочная оплата по вине платежной инфраструктуры;</li>
              <li>невозможность предоставить оплаченный доступ по вине Исполнителя;</li>
              <li>существенный технический сбой, из-за которого сервис недоступен длительное время;</li>
              <li>иные случаи, прямо предусмотренные законодательством Республики Казахстан.</li>
            </ul>

            <h2 className={h2}>3. Когда возврат может быть ограничен</h2>
            <ul className={ul}>
              <li>если услуга фактически оказана (доступ предоставлен и использовался);</li>
              <li>если нарушение возникло из-за действий Пользователя или третьих лиц со стороны Пользователя;</li>
              <li>если обращение не содержит данных, необходимых для идентификации платежа.</li>
            </ul>

            <h2 className={h2}>4. Сроки и порядок рассмотрения</h2>
            <p className={p}>
              4.1. Обращение рассматривается в разумный срок, обычно до 10 (десяти) рабочих дней с даты получения полной
              информации по заявке.
            </p>
            <p className={p}>
              4.2. При необходимости Исполнитель вправе запросить дополнительные сведения: номер платежа, дату оплаты,
              подтверждающие документы и контакты для связи.
            </p>
            <p className={p}>
              4.3. При положительном решении возврат осуществляется тем же способом оплаты либо иным способом,
              согласованным сторонами и допускаемым платежными правилами.
            </p>

            <h2 className={h2}>5. Форма обратной связи по возврату</h2>
            <p className={p}>
              Заполните форму ниже. Заявка будет направлена в отдел обработки обращений на адрес{" "}
              <a
                className="font-medium text-white/85 underline decoration-white/25 underline-offset-2 transition hover:text-white hover:decoration-white/50"
                href="mailto:marketing.panfilov@gmail.com"
              >
                marketing.panfilov@gmail.com
              </a>
              .
            </p>
            <RefundRequestForm />

            <h2 className={h2}>6. Реквизиты Исполнителя</h2>
            <RequisitesBlock />
          </div>
        </div>
      </section>

      <section className="relative z-10">
        <div className="mx-auto max-w-6xl px-5 pb-10">
          <div className="flex flex-col items-start justify-between gap-4 border-t border-white/8 pt-6 text-xs text-white/42 md:flex-row md:items-center">
            <div>© {new Date().getFullYear()} BoardIQ</div>

            <div className="flex flex-wrap gap-4">
              <Link className="transition hover:text-white/70" href="/terms">
                Пользовательское соглашение
              </Link>
              <Link className="transition hover:text-white/70" href="/privacy">
                Политика конфиденциальности
              </Link>
              <Link className="transition hover:text-white/70" href="/refund-policy">
                Политика возврата
              </Link>
              <Link className="transition hover:text-white/70" href="/personal-data-agreement">
                Соглашение об обработке персональных данных
              </Link>
              <Link className="transition hover:text-white/70" href="/data-deletion">
                Удаление данных
              </Link>
            </div>
          </div>
          <p className="mt-6 w-full border-t border-white/10 pt-6 text-center text-[11px] leading-relaxed text-white/32 md:text-xs">
            Все материалы, тексты, изображения и иные данные на сайте являются интеллектуальной собственностью правообладателя.
            Копирование, воспроизведение, переработка или публичное упоминание допускаются только после предварительного
            письменного согласия и подтверждения со стороны правообладателя; иное использование без разрешения запрещено.
          </p>
        </div>
      </section>
    </main>
  );
}
