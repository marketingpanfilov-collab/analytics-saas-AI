import Link from "next/link";

import { LandingHeader } from "@/components/layout/LandingHeader";

export default function TermsPage() {
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
          <h1 className="mt-3 text-3xl font-extrabold leading-tight text-white md:text-4xl">
            Пользовательское соглашение
          </h1>
          <p className="mt-4 max-w-2xl text-base leading-relaxed text-white/58">
            Условия использования сервиса BoardIQ, порядок доступа к функционалу платформы, правила обработки данных, ограничения ответственности и иные юридически значимые положения.
          </p>

          <div className="mt-10 rounded-[28px] border border-white/10 bg-white/[0.04] p-6 backdrop-blur-md md:p-8">
            <h2 className="mb-3 mt-0 text-lg font-semibold text-white/95">1. Общие положения</h2>
            <p className="text-sm leading-relaxed text-white/60">
              1.1. Настоящее Пользовательское соглашение (далее — «Соглашение») является публичной офертой в соответствии с положениями Гражданского кодекса Республики Казахстан и регулирует отношения между:
            </p>
            <p className="text-sm leading-relaxed text-white/60">
              Индивидуальным предпринимателем AGTWO, в лице Гончарук Анастасии Сергеевны, действующего на основании уведомления о начале деятельности № KZ50UWQ07924772, адрес: г. Алматы, Медеуский район, ул. Кунаева, д. 15/1, (далее — «Исполнитель»),
            </p>
            <p className="text-sm leading-relaxed text-white/60">
              и любым физическим или юридическим лицом (далее — «Пользователь»).
            </p>
            <p className="text-sm leading-relaxed text-white/60">
              1.2. Сервис представляет собой программное обеспечение, предоставляемое по модели Software as a Service (SaaS), доступ к которому осуществляется через сеть Интернет.
            </p>
            <p className="text-sm leading-relaxed text-white/60">1.3. Акцептом настоящего Соглашения признается:</p>
            <ul className="list-disc space-y-1.5 pl-5 text-sm leading-relaxed text-white/60">
              <li>регистрация в сервисе;</li>
              <li>начало использования сервиса;</li>
              <li>оплата услуг.</li>
            </ul>
            <p className="text-sm leading-relaxed text-white/60">
              1.4. Акцепт Соглашения означает полное и безоговорочное согласие Пользователя с его условиями и приравнивается к заключению договора в письменной форме.
            </p>
            <p className="text-sm leading-relaxed text-white/60">
              1.5. В случае несогласия с условиями Соглашения Пользователь обязан немедленно прекратить использование сервиса.
            </p>
            <p className="text-sm leading-relaxed text-white/60">1.6. К отношениям сторон применяется право Республики Казахстан.</p>

            <h2 className="mb-3 mt-8 text-lg font-semibold text-white/95">2. Предмет соглашения</h2>
            <p className="text-sm leading-relaxed text-white/60">
              2.1. Исполнитель предоставляет Пользователю неисключительное, ограниченное право доступа к функционалу сервиса.
            </p>
            <p className="text-sm leading-relaxed text-white/60">2.2. Сервис предназначен для:</p>
            <ul className="list-disc space-y-1.5 pl-5 text-sm leading-relaxed text-white/60">
              <li>аналитики маркетинговых данных;</li>
              <li>обработки и визуализации информации;</li>
              <li>интеграции с внешними платформами;</li>
              <li>формирования отчетности.</li>
            </ul>
            <p className="text-sm leading-relaxed text-white/60">2.3. Сервис не является:</p>
            <ul className="list-disc space-y-1.5 pl-5 text-sm leading-relaxed text-white/60">
              <li>финансовым, инвестиционным, юридическим или налоговым консультантом;</li>
              <li>источником гарантированных результатов.</li>
            </ul>

            <h2 className="mb-3 mt-8 text-lg font-semibold text-white/95">3. Регистрация и учетная запись</h2>
            <p className="text-sm leading-relaxed text-white/60">
              3.1. Для использования сервиса Пользователь обязан пройти регистрацию.
            </p>
            <p className="text-sm leading-relaxed text-white/60">3.2. Пользователь обязуется:</p>
            <ul className="list-disc space-y-1.5 pl-5 text-sm leading-relaxed text-white/60">
              <li>предоставлять достоверную информацию;</li>
              <li>поддерживать актуальность данных;</li>
              <li>не передавать доступ третьим лицам.</li>
            </ul>
            <p className="text-sm leading-relaxed text-white/60">
              3.3. Пользователь несет ответственность за все действия, совершенные через его аккаунт.
            </p>
            <p className="text-sm leading-relaxed text-white/60">
              3.4. Исполнитель не несет ответственности за последствия несанкционированного доступа, если он произошел не по вине Исполнителя.
            </p>

            <h2 className="mb-3 mt-8 text-lg font-semibold text-white/95">4. Условия использования сервиса</h2>
            <p className="text-sm leading-relaxed text-white/60">4.1. Пользователю запрещается:</p>
            <ul className="list-disc space-y-1.5 pl-5 text-sm leading-relaxed text-white/60">
              <li>нарушать работу сервиса;</li>
              <li>обходить технические ограничения;</li>
              <li>осуществлять reverse engineering;</li>
              <li>использовать сервис для противоправных целей;</li>
              <li>перегружать систему (включая злоупотребление API).</li>
            </ul>
            <p className="text-sm leading-relaxed text-white/60">4.2. Исполнитель вправе вводить ограничения:</p>
            <ul className="list-disc space-y-1.5 pl-5 text-sm leading-relaxed text-white/60">
              <li>по количеству запросов;</li>
              <li>по объему данных;</li>
              <li>по функционалу тарифов.</li>
            </ul>

            <h2 className="mb-3 mt-8 text-lg font-semibold text-white/95">5. Платежи и подписка</h2>
            <p className="text-sm leading-relaxed text-white/60">
              5.1. Доступ к сервису может предоставляться на платной основе.
            </p>
            <p className="text-sm leading-relaxed text-white/60">
              5.2. Оплата осуществляется по модели подписки или по иным тарифам.
            </p>
            <p className="text-sm leading-relaxed text-white/60">
              5.3. Подписка автоматически продлевается, если Пользователь не отменил ее до даты списания.
            </p>
            <p className="text-sm leading-relaxed text-white/60">
              5.4. Пользователь дает согласие на автоматическое списание денежных средств.
            </p>
            <p className="text-sm leading-relaxed text-white/60">
              5.5. Все платежи являются окончательными и не подлежат возврату, за исключением случаев, предусмотренных законодательством Республики Казахстан.
            </p>
            <p className="text-sm leading-relaxed text-white/60">
              5.6. Исполнитель вправе изменять тарифы, уведомляя Пользователя через интерфейс сервиса.
            </p>
            <p className="text-sm leading-relaxed text-white/60">
              5.7. Продолжение использования сервиса означает согласие с новыми тарифами.
            </p>

            <h2 className="mb-3 mt-8 text-lg font-semibold text-white/95">6. Интеграции и сторонние сервисы</h2>
            <p className="text-sm leading-relaxed text-white/60">
              6.1. Сервис может интегрироваться с внешними платформами, включая, но не ограничиваясь:
            </p>
            <ul className="list-disc space-y-1.5 pl-5 text-sm leading-relaxed text-white/60">
              <li>Meta (Facebook, Instagram);</li>
              <li>Google;</li>
              <li>TikTok;</li>
              <li>Яндекс;</li>
              <li>CRM и иными системами.</li>
            </ul>
            <p className="text-sm leading-relaxed text-white/60">6.2. Исполнитель не является владельцем указанных платформ.</p>
            <p className="text-sm leading-relaxed text-white/60">6.3. Исполнитель не несет ответственности за:</p>
            <ul className="list-disc space-y-1.5 pl-5 text-sm leading-relaxed text-white/60">
              <li>изменения API;</li>
              <li>блокировки аккаунтов;</li>
              <li>ошибки и искажения данных;</li>
              <li>ограничения со стороны платформ.</li>
            </ul>
            <p className="text-sm leading-relaxed text-white/60">
              6.4. Исполнитель не гарантирует непрерывную работу интеграций.
            </p>

            <h2 className="mb-3 mt-8 text-lg font-semibold text-white/95">7. Обработка данных</h2>
            <p className="text-sm leading-relaxed text-white/60">
              7.1. Исполнитель выступает в качестве обработчика данных (data processor).
            </p>
            <p className="text-sm leading-relaxed text-white/60">
              7.2. Пользователь является оператором и владельцем данных.
            </p>
            <p className="text-sm leading-relaxed text-white/60">7.3. Пользователь самостоятельно определяет:</p>
            <ul className="list-disc space-y-1.5 pl-5 text-sm leading-relaxed text-white/60">
              <li>цели обработки;</li>
              <li>состав данных;</li>
              <li>правовые основания.</li>
            </ul>
            <p className="text-sm leading-relaxed text-white/60">
              7.4. Пользователь гарантирует законность передачи данных.
            </p>
            <p className="text-sm leading-relaxed text-white/60">7.5. Исполнитель обрабатывает данные исключительно:</p>
            <ul className="list-disc space-y-1.5 pl-5 text-sm leading-relaxed text-white/60">
              <li>в рамках работы сервиса;</li>
              <li>по поручению Пользователя.</li>
            </ul>
            <p className="text-sm leading-relaxed text-white/60">
              7.6. Данные могут обрабатываться с использованием облачных и сторонних инфраструктурных решений.
            </p>

            <h2 className="mb-3 mt-8 text-lg font-semibold text-white/95">8. Безопасность и ответственность за данные</h2>
            <p className="text-sm leading-relaxed text-white/60">
              8.1. Исполнитель принимает разумные организационные и технические меры для защиты данных.
            </p>
            <p className="text-sm leading-relaxed text-white/60">
              8.2. Исполнитель несет ответственность только в случае, если утечка произошла по его прямой вине.
            </p>
            <p className="text-sm leading-relaxed text-white/60">8.3. Исполнитель не несет ответственности за:</p>
            <ul className="list-disc space-y-1.5 pl-5 text-sm leading-relaxed text-white/60">
              <li>действия Пользователя;</li>
              <li>утрату доступа;</li>
              <li>компрометацию учетных данных;</li>
              <li>действия третьих лиц и сервисов.</li>
            </ul>
            <p className="text-sm leading-relaxed text-white/60">
              8.4. Пользователь осознает риски передачи данных через интернет.
            </p>

            <h2 className="mb-3 mt-8 text-lg font-semibold text-white/95">9. Ограничение ответственности</h2>
            <p className="text-sm leading-relaxed text-white/60">
              9.1. Сервис предоставляется «как есть» и «по мере доступности».
            </p>
            <p className="text-sm leading-relaxed text-white/60">9.2. Исполнитель не гарантирует:</p>
            <ul className="list-disc space-y-1.5 pl-5 text-sm leading-relaxed text-white/60">
              <li>соответствие ожиданиям;</li>
              <li>достижение результатов;</li>
              <li>бесперебойную работу.</li>
            </ul>
            <p className="text-sm leading-relaxed text-white/60">
              9.3. Пользователь самостоятельно принимает решения на основе данных сервиса.
            </p>
            <p className="text-sm leading-relaxed text-white/60">9.4. Исполнитель не несет ответственности за:</p>
            <ul className="list-disc space-y-1.5 pl-5 text-sm leading-relaxed text-white/60">
              <li>любые решения Пользователя;</li>
              <li>убытки, включая упущенную выгоду;</li>
              <li>косвенные или случайные убытки.</li>
            </ul>
            <p className="text-sm leading-relaxed text-white/60">
              9.5. Совокупная ответственность Исполнителя ограничивается суммой, уплаченной Пользователем за последние 3 месяца.
            </p>

            <h2 className="mb-3 mt-8 text-lg font-semibold text-white/95">10. Интеллектуальная собственность</h2>
            <p className="text-sm leading-relaxed text-white/60">
              10.1. Все права на сервис принадлежат Исполнителю.
            </p>
            <p className="text-sm leading-relaxed text-white/60">
              10.2. Пользователь получает ограниченное право использования.
            </p>
            <p className="text-sm leading-relaxed text-white/60">10.3. Запрещается:</p>
            <ul className="list-disc space-y-1.5 pl-5 text-sm leading-relaxed text-white/60">
              <li>копирование;</li>
              <li>декомпиляция;</li>
              <li>создание аналогичных решений;</li>
              <li>незаконное использование API.</li>
            </ul>

            <h2 className="mb-3 mt-8 text-lg font-semibold text-white/95">11. Блокировка и прекращение доступа</h2>
            <p className="text-sm leading-relaxed text-white/60">11.1. Исполнитель вправе:</p>
            <ul className="list-disc space-y-1.5 pl-5 text-sm leading-relaxed text-white/60">
              <li>ограничить доступ;</li>
              <li>удалить аккаунт;</li>
              <li>приостановить работу сервиса.</li>
            </ul>
            <p className="text-sm leading-relaxed text-white/60">
              11.2. Блокировка может быть осуществлена без объяснения причин.
            </p>

            <h2 className="mb-3 mt-8 text-lg font-semibold text-white/95">12. Форс-мажор</h2>
            <p className="text-sm leading-relaxed text-white/60">
              12.1. Исполнитель не несет ответственности за неисполнение обязательств вследствие обстоятельств непреодолимой силы, включая:
            </p>
            <ul className="list-disc space-y-1.5 pl-5 text-sm leading-relaxed text-white/60">
              <li>сбои инфраструктуры;</li>
              <li>действия государственных органов;</li>
              <li>ограничения со стороны платформ;</li>
              <li>технические сбои.</li>
            </ul>

            <h2 className="mb-3 mt-8 text-lg font-semibold text-white/95">13. Разрешение споров</h2>
            <p className="text-sm leading-relaxed text-white/60">
              13.1. Все споры разрешаются путем переговоров.
            </p>
            <p className="text-sm leading-relaxed text-white/60">
              13.2. При недостижении соглашения — в судебном порядке.
            </p>
            <p className="text-sm leading-relaxed text-white/60">
              13.3. Подсудность — по месту регистрации Исполнителя.
            </p>

            <h2 className="mb-3 mt-8 text-lg font-semibold text-white/95">14. Изменение соглашения</h2>
            <p className="text-sm leading-relaxed text-white/60">
              14.1. Исполнитель вправе изменять Соглашение в любое время.
            </p>
            <p className="text-sm leading-relaxed text-white/60">
              14.2. Новая версия вступает в силу с момента публикации.
            </p>
            <p className="text-sm leading-relaxed text-white/60">
              14.3. Продолжение использования означает согласие.
            </p>

            <h2 className="mb-3 mt-8 text-lg font-semibold text-white/95">15. Реквизиты</h2>
            <p className="text-sm leading-relaxed text-white/60">ИП AGTWO</p>
            <p className="text-sm leading-relaxed text-white/60">Гончарук Анастасия Сергеевна</p>
            <p className="text-sm leading-relaxed text-white/60">ИИН/БИН 020626650776</p>
            <p className="text-sm leading-relaxed text-white/60">№ KZ50UWQ07924772</p>
            <p className="text-sm leading-relaxed text-white/60">г. Алматы, ул. Кунаева, д. 15/1</p>

            <h2 className="mb-3 mt-8 text-lg font-semibold text-white/95">16. Контакты</h2>
            <p className="text-sm leading-relaxed text-white/60">
              Контактные данные указываются в интерфейсе сервиса
            </p>

            <p className="mt-10 text-xs text-white/40">
              Последнее обновление:{" "}
              {new Date().toLocaleDateString("ru-RU", {
                day: "numeric",
                month: "long",
                year: "numeric",
              })}
            </p>
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
              <Link className="transition hover:text-white/70" href="/data-deletion">
                Удаление данных
              </Link>
            </div>
          </div>
        </div>
      </section>
    </main>
  );
}
