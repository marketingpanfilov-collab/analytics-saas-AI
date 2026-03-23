"use client";

import Link from "next/link";
import { FormEvent, useState } from "react";

import { LandingHeader } from "@/components/layout/LandingHeader";

const fieldClass =
  "w-full rounded-xl border border-white/10 bg-white/[0.04] px-4 py-3 text-sm text-white placeholder:text-white/35 outline-none transition focus:border-white/20 focus:ring-1 focus:ring-white/10";

export default function DataDeletionPage() {
  const [submitting, setSubmitting] = useState(false);
  const [success, setSuccess] = useState(false);
  const [requestId, setRequestId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    const form = e.currentTarget;
    const fd = new FormData(form);

    const payload = {
      fullName: String(fd.get("fullName") ?? ""),
      contactEmail: String(fd.get("contactEmail") ?? ""),
      accountEmail: String(fd.get("accountEmail") ?? ""),
      phone: String(fd.get("phone") ?? ""),
      requestType: String(fd.get("requestType") ?? ""),
      integration: String(fd.get("integration") ?? ""),
      description: String(fd.get("description") ?? ""),
    };

    try {
      const res = await fetch("/api/data-deletion", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = (await res.json()) as { success?: boolean; requestId?: string; error?: string };

      if (!res.ok) {
        setError(data.error || "Не удалось отправить запрос. Попробуйте позже.");
        return;
      }

      if (data.success && data.requestId) {
        setRequestId(data.requestId);
        setSuccess(true);
      } else {
        setError("Неожиданный ответ сервера.");
      }
    } catch {
      setError("Ошибка сети. Проверьте подключение и попробуйте снова.");
    } finally {
      setSubmitting(false);
    }
  }

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
            Удаление персональных данных
          </h1>
          <p className="mt-4 max-w-2xl text-base leading-relaxed text-white/58">
            Подайте запрос на удаление аккаунта, персональных данных или данных, полученных через интеграции. После отправки заявки вы получите подтверждение на email о том, что запрос принят в обработку.
          </p>

          <div className="mt-10 rounded-[28px] border border-white/10 bg-white/[0.04] p-6 backdrop-blur-md md:p-8">
            <h2 className="mb-3 mt-0 text-lg font-semibold text-white/95">Как подать запрос</h2>
            <ol className="list-decimal space-y-2 pl-5 text-sm leading-relaxed text-white/60">
              <li>Заполните форму ниже.</li>
              <li>Укажите email, связанный с вашим аккаунтом или данными.</li>
              <li>Опишите, какие данные необходимо удалить.</li>
              <li>
                После отправки формы на указанный email будет направлено подтверждение о том, что запрос принят в обработку.
              </li>
              <li>При необходимости мы можем запросить дополнительную информацию для идентификации заявителя.</li>
            </ol>

            {!success ? (
              <div className="mt-10 border-t border-white/8 pt-8">
                <h2 className="mb-6 text-lg font-semibold text-white/95">Форма запроса</h2>
                <form className="space-y-5" onSubmit={handleSubmit}>
                  <div>
                    <label className="mb-1.5 block text-sm font-medium text-white/80" htmlFor="fullName">
                      ФИО
                    </label>
                    <input
                      id="fullName"
                      name="fullName"
                      type="text"
                      autoComplete="name"
                      className={fieldClass}
                      required
                    />
                  </div>
                  <div>
                    <label className="mb-1.5 block text-sm font-medium text-white/80" htmlFor="contactEmail">
                      Email для связи
                    </label>
                    <input
                      id="contactEmail"
                      name="contactEmail"
                      type="email"
                      autoComplete="email"
                      className={fieldClass}
                      required
                    />
                  </div>
                  <div>
                    <label className="mb-1.5 block text-sm font-medium text-white/80" htmlFor="accountEmail">
                      Email аккаунта
                    </label>
                    <input
                      id="accountEmail"
                      name="accountEmail"
                      type="email"
                      autoComplete="email"
                      className={fieldClass}
                      required
                    />
                  </div>
                  <div>
                    <label className="mb-1.5 block text-sm font-medium text-white/80" htmlFor="phone">
                      Телефон <span className="text-white/45">(необязательно)</span>
                    </label>
                    <input
                      id="phone"
                      name="phone"
                      type="tel"
                      autoComplete="tel"
                      className={fieldClass}
                    />
                  </div>
                  <div>
                    <label className="mb-1.5 block text-sm font-medium text-white/80" htmlFor="requestType">
                      Тип запроса
                    </label>
                    <select id="requestType" name="requestType" className={fieldClass} required defaultValue="">
                      <option value="" disabled>
                        Выберите тип запроса
                      </option>
                      <option value="account">Удаление аккаунта</option>
                      <option value="personal">Удаление персональных данных</option>
                      <option value="integrations">Удаление данных интеграций</option>
                      <option value="withdraw">Отзыв согласия на обработку</option>
                    </select>
                  </div>
                  <div>
                    <label className="mb-1.5 block text-sm font-medium text-white/80" htmlFor="integration">
                      Интеграции
                    </label>
                    <select id="integration" name="integration" className={fieldClass} defaultValue="">
                      <option value="">Не применимо / не выбрано</option>
                      <option value="meta">Meta</option>
                      <option value="google">Google</option>
                      <option value="tiktok">TikTok</option>
                      <option value="yandex">Яндекс</option>
                      <option value="other">Другое</option>
                    </select>
                  </div>
                  <div>
                    <label className="mb-1.5 block text-sm font-medium text-white/80" htmlFor="description">
                      Описание запроса
                    </label>
                    <textarea
                      id="description"
                      name="description"
                      rows={5}
                      className={`${fieldClass} min-h-[120px] resize-y`}
                      required
                    />
                  </div>
                  <div className="flex gap-3">
                    <input
                      id="confirmSelf"
                      name="confirmSelf"
                      type="checkbox"
                      className="mt-1 h-4 w-4 shrink-0 rounded border-white/20 bg-white/[0.04] text-emerald-500 focus:ring-white/20"
                      required
                    />
                    <label className="text-sm leading-relaxed text-white/60" htmlFor="confirmSelf">
                      Я подтверждаю, что указанные данные относятся ко мне либо я действую от имени уполномоченного лица.
                    </label>
                  </div>
                  <div className="flex gap-3">
                    <input
                      id="confirmAccuracy"
                      name="confirmAccuracy"
                      type="checkbox"
                      className="mt-1 h-4 w-4 shrink-0 rounded border-white/20 bg-white/[0.04] text-emerald-500 focus:ring-white/20"
                      required
                    />
                    <label className="text-sm leading-relaxed text-white/60" htmlFor="confirmAccuracy">
                      Я подтверждаю достоверность предоставленных сведений.
                    </label>
                  </div>
                  {error ? (
                    <p className="text-sm text-red-400/95" role="alert">
                      {error}
                    </p>
                  ) : null}
                  <button
                    type="submit"
                    disabled={submitting}
                    className="inline-flex h-12 w-full items-center justify-center rounded-xl border border-[rgba(34,197,94,0.36)] bg-[rgba(34,197,94,0.18)] px-6 text-sm font-extrabold text-white shadow-[0_10px_30px_rgba(34,197,94,0.14)] transition hover:bg-[rgba(34,197,94,0.26)] hover:shadow-[0_0_30px_rgba(34,197,94,0.18)] disabled:pointer-events-none disabled:opacity-50 sm:w-auto sm:min-w-[200px]"
                  >
                    {submitting ? "Отправка…" : "Отправить запрос"}
                  </button>
                </form>
              </div>
            ) : (
              <div className="mt-10 border-t border-white/8 pt-8">
                <h2 className="mb-3 text-lg font-semibold text-white/95">Запрос отправлен</h2>
                <p className="text-sm leading-relaxed text-white/60">
                  Ваш запрос принят в обработку. Мы отправили подтверждение на указанный email.
                </p>
                {requestId ? (
                  <p className="mt-4 text-sm leading-relaxed text-white/75">
                    Номер запроса: <span className="font-mono text-white/90">{requestId}</span>
                  </p>
                ) : null}
              </div>
            )}

            <div className="mt-10 border-t border-white/8 pt-8">
              <h2 className="mb-3 text-lg font-semibold text-white/95">Что происходит после отправки</h2>
              <p className="text-sm leading-relaxed text-white/60">
                После отправки запроса вы получите подтверждение на email о том, что запрос принят в обработку. В отдельных случаях мы можем запросить дополнительную информацию для подтверждения личности или полномочий заявителя. Удаление части данных может быть отложено, если такие данные подлежат обязательному хранению по законодательству Республики Казахстан либо находятся в резервных и технических системах в пределах штатного цикла обработки и очистки.
              </p>
            </div>

            <div className="mt-10 border-t border-white/8 pt-8">
              <p className="text-sm leading-relaxed text-white/60">
                По вопросам, связанным с удалением данных и обработкой персональных данных, вы можете связаться с нами по адресу:{" "}
                <a
                  className="font-medium text-white/85 underline decoration-white/25 underline-offset-2 transition hover:text-white hover:decoration-white/50"
                  href="mailto:privacy@boardiq.kz"
                >
                  privacy@boardiq.kz
                </a>
              </p>
            </div>
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
