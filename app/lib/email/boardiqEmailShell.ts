/**
 * Разметка писем BoardIQ — та же карточка/кнопка/footer, что в supabase/templates/confirm_signup.html (эталон).
 * confirm_signup.html в репозитории не дублируем построчно в комментариях — структура синхронизирована вручную.
 */

export function escapeHtmlForEmail(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export type BoardiqTransactionalEmailParams = {
  title: string;
  /** HTML между заголовком и кнопкой; динамику собирать из escapeHtml. */
  bodyHtml: string;
  ctaLabel: string;
  actionUrl: string;
  /** Абзац перед юридическим блоком (как в confirm). */
  midNote?: string;
};

/**
 * Фрагмент HTML тела письма (как у Supabase-шаблонов в репозитории — без обёртки html/head).
 */
export function buildBoardiqTransactionalEmailHtml(
  params: BoardiqTransactionalEmailParams
): string {
  const title = escapeHtmlForEmail(params.title);
  const cta = escapeHtmlForEmail(params.ctaLabel);
  const href = escapeHtmlForEmail(params.actionUrl);
  const linkText = href;
  const mid = params.midNote
    ? `<p style="color:#6b7280;font-size:12px;line-height:1.6;margin:0 0 16px;">${escapeHtmlForEmail(params.midNote)}</p>`
    : "";

  return `<div style="background:#0b0b0f;padding:40px 20px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Arial,sans-serif;">
  <div style="max-width:520px;margin:0 auto;background:linear-gradient(180deg,#141420,#0f0f17);border-radius:16px;padding:32px;border:1px solid rgba(255,255,255,0.06);">

    <div style="margin-bottom:28px;">
      <table role="presentation" cellpadding="0" cellspacing="0" border="0" style="border-collapse:collapse;mso-table-lspace:0;mso-table-rspace:0;">
        <tr>
          <td style="vertical-align:middle;padding:0 12px 0 0;">
            <div style="width:40px;height:40px;border-radius:12px;border:1px solid rgba(255,255,255,0.1);background:rgba(255,255,255,0.06);line-height:40px;text-align:center;font-size:13px;font-weight:900;color:#f5f5f5;font-family:Arial,Helvetica,sans-serif;">
              BIQ
            </div>
          </td>
          <td style="vertical-align:middle;padding:0;">
            <div style="color:#f5f5f5;font-size:14px;font-weight:800;line-height:1.25;margin:0;">BoardIQ</div>
            <div style="color:rgba(255,255,255,0.5);font-size:12px;line-height:1.25;margin:0;">analytics</div>
          </td>
        </tr>
      </table>
    </div>

    <h1 style="color:#ffffff;font-size:22px;margin:0 0 16px;">
      ${title}
    </h1>

    ${params.bodyHtml}

    <a href="${href}"
       style="display:block;text-align:center;background:linear-gradient(90deg,#6366f1,#22c55e);color:#ffffff;text-decoration:none;padding:14px 20px;border-radius:10px;font-weight:500;margin-bottom:24px;">
      ${cta}
    </a>

    <p style="color:#6b7280;font-size:12px;margin:0 0 8px;">
      Если кнопка не работает, откройте ссылку:
    </p>

    <p style="word-break:break-all;color:#6b7280;font-size:12px;margin:0 0 24px;">
      ${linkText}
    </p>

    <div style="height:1px;background:rgba(255,255,255,0.06);margin:24px 0;"></div>

    ${mid}

    <p style="color:#6b7280;font-size:11px;line-height:1.6;margin:0;">
      Продолжая использование сервиса, вы соглашаетесь с
      <a href="https://boardiq.kz/terms" style="color:#9ca3af;text-decoration:underline;">пользовательским соглашением</a>
      и
      <a href="https://boardiq.kz/privacy" style="color:#9ca3af;text-decoration:underline;">политикой обработки данных</a>.
    </p>

  </div>
</div>`;
}
