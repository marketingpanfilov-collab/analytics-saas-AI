/**
 * Разметка писем BoardIQ — та же карточка/кнопка/footer, что в supabase/templates/confirm_signup.html (эталон).
 * Для мобильных клиентов (Apple Mail dark mode): meta color-scheme + !important / -webkit-text-fill-color на тексте.
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

const EMAIL_HEAD = `<!DOCTYPE html>
<html lang="ru" xmlns="http://www.w3.org/1999/xhtml">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="color-scheme" content="light">
<meta name="supported-color-schemes" content="light">
</head>
<body style="margin:0;padding:0;background-color:#0b0b0f !important;-webkit-text-size-adjust:100%;">
`;

const EMAIL_TAIL = `
</body>
</html>`;

/**
 * Полное письмо с <head> (color-scheme) — лучше для Apple Mail / тёмной темы клиента.
 */
export function buildBoardiqTransactionalEmailHtml(
  params: BoardiqTransactionalEmailParams
): string {
  const title = escapeHtmlForEmail(params.title);
  const cta = escapeHtmlForEmail(params.ctaLabel);
  const href = escapeHtmlForEmail(params.actionUrl);
  const linkText = href;
  const mid = params.midNote
    ? `<p style="margin:0 0 16px;color:#a1a1aa !important;-webkit-text-fill-color:#a1a1aa !important;font-size:12px;line-height:1.6;">${escapeHtmlForEmail(params.midNote)}</p>`
    : "";

  const fragment = `<div style="background-color:#0b0b0f !important;padding:40px 20px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Arial,sans-serif;">
  <div style="max-width:520px;margin:0 auto;background:linear-gradient(180deg,#141420,#0f0f17) !important;background-color:#141420 !important;border-radius:16px;padding:32px;border:1px solid rgba(255,255,255,0.06);">

    <div style="margin-bottom:28px;">
      <table role="presentation" cellpadding="0" cellspacing="0" border="0" style="border-collapse:collapse;mso-table-lspace:0;mso-table-rspace:0;">
        <tr>
          <td style="vertical-align:middle;padding:0 12px 0 0;">
            <div style="width:40px;height:40px;border-radius:12px;border:1px solid rgba(255,255,255,0.1);background:rgba(255,255,255,0.06);line-height:40px;text-align:center;font-size:13px;font-weight:900;color:#f5f5f5 !important;-webkit-text-fill-color:#f5f5f5 !important;font-family:Arial,Helvetica,sans-serif;">
              BIQ
            </div>
          </td>
          <td style="vertical-align:middle;padding:0;">
            <div style="color:#f5f5f5 !important;-webkit-text-fill-color:#f5f5f5 !important;font-size:14px;font-weight:800;line-height:1.25;margin:0;">BoardIQ</div>
            <div style="color:#a1a1aa !important;-webkit-text-fill-color:#a1a1aa !important;font-size:12px;line-height:1.25;margin:0;">analytics</div>
          </td>
        </tr>
      </table>
    </div>

    <h1 style="color:#ffffff !important;-webkit-text-fill-color:#ffffff !important;font-size:22px;margin:0 0 16px;">
      ${title}
    </h1>

    ${params.bodyHtml}

    <a href="${href}"
       style="display:block;text-align:center;background:linear-gradient(90deg,#6366f1,#22c55e);color:#ffffff !important;-webkit-text-fill-color:#ffffff !important;text-decoration:none !important;padding:14px 20px;border-radius:10px;font-weight:500;margin-bottom:24px;">
      ${cta}
    </a>

    <p style="margin:0 0 8px;color:#a1a1aa !important;-webkit-text-fill-color:#a1a1aa !important;font-size:12px;">
      Если кнопка не работает, откройте ссылку:
    </p>

    <p style="word-break:break-all;margin:0 0 24px;color:#93c5fd !important;-webkit-text-fill-color:#93c5fd !important;font-size:12px;">
      ${linkText}
    </p>

    <div style="height:1px;background:rgba(255,255,255,0.06);margin:24px 0;"></div>

    ${mid}

    <p style="margin:0;color:#a1a1aa !important;-webkit-text-fill-color:#a1a1aa !important;font-size:11px;line-height:1.6;">
      Продолжая использование сервиса, вы соглашаетесь с
      <a href="https://boardiq.kz/terms" style="color:#c4c4cc !important;-webkit-text-fill-color:#c4c4cc !important;text-decoration:underline !important;">пользовательским соглашением</a>
      и
      <a href="https://boardiq.kz/privacy" style="color:#c4c4cc !important;-webkit-text-fill-color:#c4c4cc !important;text-decoration:underline !important;">политикой обработки данных</a>.
    </p>

  </div>
</div>`;

  return EMAIL_HEAD + fragment + EMAIL_TAIL;
}
