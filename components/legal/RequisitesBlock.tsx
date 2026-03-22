const linkClass = "text-white/80 underline underline-offset-2 transition hover:text-white";

type RequisitesBlockProps = {
  className?: string;
};

/**
 * Единый блок реквизитов ИП (Исполнитель / Оператор / Обработчик) на юридических страницах.
 */
export function RequisitesBlock({ className }: RequisitesBlockProps) {
  return (
    <div className={["space-y-1 text-sm leading-relaxed text-white/60", className].filter(Boolean).join(" ")}>
      <p>ИП AGTWO</p>
      <p>Руководитель: Гончарук Анастасия Сергеевна</p>
      <p>ИИН/БИН 020626650776</p>
      <p>Уведомление о начале деятельности: № KZ50UWQ07924772</p>
      <p>Адрес: г. Алматы, Медеуский район, ул. Кунаева, д. 15/1</p>
      <p>Контакты:</p>
      <p>
        <a className={linkClass} href="mailto:support@boardiq.kz">
          support@boardiq.kz
        </a>
      </p>
      <p>
        <a className={linkClass} href="mailto:privacy@boardiq.kz">
          privacy@boardiq.kz
        </a>
      </p>
    </div>
  );
}
