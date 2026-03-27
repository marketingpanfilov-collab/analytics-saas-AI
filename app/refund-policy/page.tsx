import Link from "next/link";

import { LandingHeader } from "@/components/layout/LandingHeader";
import { RequisitesBlock } from "@/components/legal/RequisitesBlock";
import { RefundRequestForm } from "@/components/legal/RefundRequestForm";

const p = "text-sm leading-relaxed text-white/60";
const h2 = "mb-3 mt-8 text-lg font-semibold text-white/95 first:mt-0";

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
            Оплата подписок и цифровых услуг BoardIQ обрабатывается платёжным провайдером Paddle. Настоящая политика
            соответствует требованиям Paddle к политике возврата и дополняет условия, применимые к вашей сделке с Paddle.
          </p>

          <div className="mt-10 rounded-[28px] border border-white/10 bg-white/[0.04] p-6 backdrop-blur-md md:p-8">
            <h2 className={h2}>1. Общие положения</h2>
            <p className={p}>
              1.1. Paddle выступает продавцом записи (Merchant of Record) по платежам, совершённым через Paddle
              Checkout. Условия покупки, подписок и возвратов в части платежа регулируются документами Paddle, в том числе{" "}
              <a
                className="text-white/80 underline underline-offset-2 hover:text-white"
                href="https://www.paddle.com/legal/buyer-terms"
                target="_blank"
                rel="noreferrer"
              >
                Paddle Buyer Terms
              </a>{" "}
              и{" "}
              <a
                className="text-white/80 underline underline-offset-2 hover:text-white"
                href="https://www.paddle.com/legal/refund-policy"
                target="_blank"
                rel="noreferrer"
              >
                Paddle Refund Policy
              </a>
              .
            </p>
            <p className={p}>
              1.2. Доступ к продукту BoardIQ после оплаты предоставляется Поставщиком (BoardIQ) в соответствии с{" "}
              <Link className="text-white/80 underline underline-offset-2 hover:text-white" href="/terms">
                Пользовательским соглашением
              </Link>
              .
            </p>
            <p className={p}>
              1.3. Настоящая страница применяется совместно с{" "}
              <Link className="text-white/80 underline underline-offset-2 hover:text-white" href="/terms">
                Пользовательским соглашением
              </Link>{" "}
              и{" "}
              <Link className="text-white/80 underline underline-offset-2 hover:text-white" href="/privacy">
                Политикой конфиденциальности
              </Link>
              .
            </p>
            <p className={p}>
              1.4. Если иное не требуется обязательными нормами применимого права, транзакции считаются не подлежащими
              возврату и обмену; при этом Paddle может рассматривать отдельные запросы на дискреционной основе в
              соответствии со своей политикой.
            </p>

            <h2 className={h2}>2. Срок на запрос возврата (refund window)</h2>
            <p className={p}>
              Для покупателей, на которых распространяется обязательное право на отказ/возврат по применимому праву
              (включая нормы Республики Казахстан), применяется срок{" "}
              <strong className="font-semibold text-white/85">14 (четырнадцати) календарных дней</strong> с даты
              подтверждённой транзакции, если более длительный или иной обязательный срок не установлен законом.
            </p>
            <p className={p}>
              Поскольку Paddle является Merchant of Record, к операциям также применяются country-specific правила и
              исключения из{" "}
              <a
                className="text-white/80 underline underline-offset-2 hover:text-white"
                href="https://www.paddle.com/legal/refund-policy"
                target="_blank"
                rel="noreferrer"
              >
                Paddle Refund Policy
              </a>{" "}
              и{" "}
              <a
                className="text-white/80 underline underline-offset-2 hover:text-white"
                href="https://www.paddle.com/legal/buyer-terms"
                target="_blank"
                rel="noreferrer"
              >
                Paddle Buyer Terms
              </a>
              . При расхождении применяется тот стандарт защиты, который обязателен по закону или прямо предоставлен
              Paddle покупателю.
            </p>
            <p className={p}>
              Если транзакция не подпадает под обязательное право на возврат, возврат может быть предоставлен Paddle
              на дискреционной основе в соответствии с его политикой.
            </p>

            <h2 className={h2}>3. Как запросить возврат</h2>
            <p className={p}>
              3.1. Основной способ — запрос через buyer support Paddle ({""}
              <a
                className="text-white/80 underline underline-offset-2 hover:text-white"
                href="https://paddle.net"
                target="_blank"
                rel="noreferrer"
              >
                paddle.net
              </a>
              ), а также через ссылки «View receipt / Manage subscription» из письма о транзакции. Дополнительно можно
              использовать раздел о возвратах и отмене в{" "}
              <a
                className="text-white/80 underline underline-offset-2 hover:text-white"
                href="https://www.paddle.com/legal/refund-policy"
                target="_blank"
                rel="noreferrer"
              >
                Paddle Refund Policy
              </a>
              .
            </p>
            <p className={p}>3.2. Приоритетный канал обработки возврата — инструменты buyer support Paddle.</p>
            <p className={p}>
              3.3. Дополнительно вы можете направить обращение через форму на этой странице — заявка будет обработана
              службой поддержки BoardIQ для согласования с Paddle и ответа вам.
            </p>

            <h2 className={h2}>4. Сроки рассмотрения обращений BoardIQ</h2>
            <p className={p}>
              4.1. Обращения, полученные через форму на сайте, рассматриваются в срок до 10 (десяти) рабочих дней с даты
              получения полных данных по заявке (email, идентификатор платежа Paddle при наличии, краткое описание
              причины).
            </p>
            <p className={p}>
              4.2. Фактическое зачисление средств при одобренном возврате выполняется Paddle в соответствии с сроками
              банка и платёжной схемы.
            </p>

            <h2 className={h2}>5. Форма обратной связи по возврату</h2>
            <p className={p}>
              Заполните форму ниже. Заявка будет направлена в отдел обработки обращений.
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
