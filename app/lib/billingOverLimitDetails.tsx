import type { ReactNode } from "react";

export type OverLimitDetailRow = {
  type: "projects" | "seats" | "ad_accounts";
  current: number;
  limit: number;
};

function projectsWord(n: number): string {
  const a = Math.abs(n) % 100;
  const c = n % 10;
  if (a > 10 && a < 20) return "проектов";
  if (c === 1) return "проект";
  if (c >= 2 && c <= 4) return "проекта";
  return "проектов";
}

function adAccountsWord(n: number): string {
  const a = Math.abs(n) % 100;
  const c = n % 10;
  if (a > 10 && a < 20) return "рекламных аккаунтов";
  if (c === 1) return "рекламный аккаунт";
  if (c >= 2 && c <= 4) return "рекламных аккаунта";
  return "рекламных аккаунтов";
}

/** Список формулировок по строкам из `over_limit_details` (как в fullscreen shell). */
export function OverLimitViolationLines({
  details,
  compact = false,
  className = "",
}: {
  details: OverLimitDetailRow[];
  compact?: boolean;
  className?: string;
}): ReactNode {
  if (!details.length) return null;
  return (
    <ul
      className={`m-0 list-none px-0 text-center leading-relaxed text-white/88 ${compact ? "space-y-2 text-[13px]" : "space-y-3 text-[14px]"} ${className}`.trim()}
    >
      {details.map((row, i) => (
        <li key={i}>
          {row.type === "seats" ? (
            <>
              {row.limit === 1 ? (
                <>
                  По тарифу доступен только <strong className="text-emerald-300">1</strong> уникальный участник с
                  доступом (команда или проекты), сейчас уже <strong className="text-white">{row.current}</strong>
                </>
              ) : (
                <>
                  По тарифу не более <strong className="text-emerald-300">{row.limit}</strong> уникальных участников
                  с доступом, сейчас уже <strong className="text-white">{row.current}</strong>
                </>
              )}
            </>
          ) : row.type === "projects" ? (
            <>
              Вы добавили <strong className="text-white">{row.current}</strong> {projectsWord(row.current)}, а по тарифу
              доступно <strong className="text-emerald-300">{row.limit}</strong>
            </>
          ) : (
            <>
              Вы подключили <strong className="text-white">{row.current}</strong> {adAccountsWord(row.current)}, лимит
              тарифа — <strong className="text-emerald-300">{row.limit}</strong>
            </>
          )}
        </li>
      ))}
    </ul>
  );
}

/** Текст, если деталей превышения ещё нет в ответе. */
export function OverLimitViolationEmptyHint({
  compact = false,
  className = "",
}: {
  compact?: boolean;
  className?: string;
}): ReactNode {
  return (
    <p
      className={`m-0 text-center leading-relaxed text-white/55 ${compact ? "text-[12px]" : "text-[13px]"} ${className}`.trim()}
    >
      Лимиты вашего тарифа исчерпаны. Выберите новый тариф ниже.
    </p>
  );
}

/** Заголовок баннера/модалки по типам нарушений (см. computeOverLimitViolations — места = организация). */
export function remedialOverLimitBannerTitle(details: OverLimitDetailRow[]): string {
  if (!details.length) return "Вы достигли лимитов тарифа.";
  const types = new Set(details.map((d) => d.type));
  if (types.size === 1) {
    const t = details[0]!.type;
    if (t === "seats") return "Вы достигли лимита участников организации по тарифу.";
    if (t === "projects") return "Вы достигли лимита проектов в организации по тарифу.";
    if (t === "ad_accounts") return "Вы достигли лимита рекламных аккаунтов по тарифу.";
  }
  return "Вы достигли лимитов тарифа.";
}

/** Короткий поясняющий абзац под заголовком (контекст ≠ только проект для seats). */
export function remedialOverLimitBannerLead(details: OverLimitDetailRow[]): string {
  if (!details.length) {
    return "Чтобы продолжить работу, уменьшите количество ресурсов или обновите тариф.";
  }
  const types = new Set(details.map((d) => d.type));
  if (types.size === 1 && types.has("seats")) {
    return "Место — это уникальный пользователь с доступом в организации: «Команда» или любой проект. Один и тот же человек не занимает два места. Чтобы освободить место, уберите пользователя везде (из команды и из всех проектов) или обновите тариф.";
  }
  if (types.size === 1 && types.has("projects")) {
    return "Чтобы продолжить работу, заархивируйте лишние проекты или обновите тариф.";
  }
  if (types.size === 1 && types.has("ad_accounts")) {
    return "Чтобы продолжить работу, отключите лишние рекламные аккаунты или обновите тариф.";
  }
  return "Чтобы продолжить работу, уменьшите количество ресурсов или обновите тариф.";
}
