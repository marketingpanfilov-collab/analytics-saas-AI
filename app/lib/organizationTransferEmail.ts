import nodemailer from "nodemailer";

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function getTransporter(): nodemailer.Transporter | null {
  const resendKey = process.env.RESEND_API_KEY?.trim();
  const host =
    process.env.SMTP_HOST?.trim() || (resendKey ? "smtp.resend.com" : "");
  const user = process.env.SMTP_USER?.trim() || (resendKey ? "resend" : "");
  const pass = process.env.SMTP_PASS?.trim() || resendKey || "";
  const port = Number(process.env.SMTP_PORT || "465");
  if (!host || !user || !pass) return null;
  return nodemailer.createTransport({
    host,
    port,
    secure: port === 465,
    auth: { user, pass },
  });
}

function mailFrom(): string {
  return (
    process.env.SMTP_FROM?.trim() ||
    process.env.RESEND_FROM_EMAIL?.trim() ||
    process.env.SMTP_USER ||
    "noreply@localhost"
  );
}

export type SendOrgTransferInviteEmailParams = {
  to: string;
  acceptUrl: string;
  organizationName: string;
  expiresAtIso: string;
};

/** Письмо получателю: кнопка «Получить доступ». */
export async function sendOrganizationTransferInviteEmail(
  params: SendOrgTransferInviteEmailParams
): Promise<{ ok: true } | { ok: false; error: string }> {
  const transporter = getTransporter();
  if (!transporter) {
    return { ok: false, error: "smtp_not_configured" };
  }

  const from = mailFrom();
  const exp = new Date(params.expiresAtIso);
  const expiresRu = Number.isFinite(exp.getTime())
    ? exp.toLocaleString("ru-RU", {
        day: "numeric",
        month: "long",
        year: "numeric",
        hour: "2-digit",
        minute: "2-digit",
      })
    : params.expiresAtIso;

  const subject = `Передача управления организацией «${params.organizationName}» — BoardIQ`;
  const safeOrg = escapeHtml(params.organizationName);
  const safeExpires = escapeHtml(expiresRu);
  const safeUrl = escapeHtml(params.acceptUrl);

  const text = [
    `Вам передали управление организацией «${params.organizationName}» в BoardIQ.`,
    "",
    `Ссылка действует до: ${expiresRu}`,
    "",
    "Получить доступ:",
    params.acceptUrl,
    "",
    "Если кнопка в письме не работает, скопируйте ссылку выше в браузер.",
  ].join("\n");

  const html = `
<!DOCTYPE html>
<html lang="ru">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"></head>
<body style="margin:0;padding:0;background:#0c0c12;font-family:system-ui,-apple-system,'Segoe UI',Roboto,sans-serif;">
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#0c0c12;padding:32px 16px;">
    <tr><td align="center">
      <table role="presentation" width="100%" style="max-width:520px;background:linear-gradient(180deg,#14141c 0%,#101018 100%);border-radius:20px;border:1px solid rgba(255,255,255,0.08);">
        <tr><td style="padding:28px 28px 8px 28px;">
          <p style="margin:0;font-size:13px;font-weight:600;letter-spacing:0.12em;text-transform:uppercase;color:#34d399;">BoardIQ</p>
          <h1 style="margin:12px 0 0 0;font-size:22px;font-weight:700;color:#fafafa;">Передача управления организацией</h1>
        </td></tr>
        <tr><td style="padding:8px 28px 20px 28px;">
          <p style="margin:0;font-size:15px;line-height:1.55;color:#a1a1aa;">Организация:</p>
          <p style="margin:8px 0 0 0;font-size:20px;font-weight:700;color:#f4f4f5;">${safeOrg}</p>
          <p style="margin:16px 0 0 0;font-size:13px;color:#fbbf24;">Ссылка действует до: ${safeExpires}</p>
        </td></tr>
        <tr><td style="padding:8px 28px 28px 28px;" align="center">
          <a href="${safeUrl}" style="display:inline-block;padding:14px 32px;background:linear-gradient(180deg,#34d399 0%,#10b981 100%);color:#042f2e !important;text-decoration:none;font-weight:700;font-size:15px;border-radius:12px;">
            Получить доступ
          </a>
          <p style="margin:20px 0 0 0;font-size:12px;line-height:1.5;color:#52525b;">
            <a href="${safeUrl}" style="color:#34d399;word-break:break-all;">${safeUrl}</a>
          </p>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;

  try {
    await transporter.sendMail({
      from: `"BoardIQ" <${from}>`,
      to: params.to,
      subject,
      text,
      html,
    });
    return { ok: true };
  } catch (e) {
    console.error("[org-transfer-email] invite sendMail", e);
    return { ok: false, error: "send_failed" };
  }
}

export type SendOrgTransferCompletedEmailParams = {
  to: string;
  organizationName: string;
  newOwnerEmail: string;
  transferredAtIso: string;
  appUrl: string;
};

/** Письмо бывшему владельцу после успешной передачи. */
export async function sendOrganizationTransferCompletedEmail(
  params: SendOrgTransferCompletedEmailParams
): Promise<{ ok: true } | { ok: false; error: string }> {
  const transporter = getTransporter();
  if (!transporter) {
    return { ok: false, error: "smtp_not_configured" };
  }

  const from = mailFrom();
  const dt = new Date(params.transferredAtIso);
  const dateRu = Number.isFinite(dt.getTime())
    ? dt.toLocaleString("ru-RU", {
        day: "numeric",
        month: "long",
        year: "numeric",
        hour: "2-digit",
        minute: "2-digit",
      })
    : params.transferredAtIso;

  const subject = "Передача организации завершена";
  const safeOrg = escapeHtml(params.organizationName);
  const safeNew = escapeHtml(params.newOwnerEmail);
  const safeDate = escapeHtml(dateRu);
  const appLink = `${params.appUrl.replace(/\/$/, "")}/app/projects`;
  const safeAppLink = escapeHtml(appLink);

  const text = [
    `Вы успешно передали управление организацией «${params.organizationName}» пользователю ${params.newOwnerEmail}.`,
    `Ваш доступ к этой организации и её проектам завершён.`,
    "",
    `Дата передачи: ${dateRu}`,
    "",
    "Если у вас есть другие организации в BoardIQ, вы можете открыть приложение:",
    appLink,
  ].join("\n");

  const html = `
<!DOCTYPE html>
<html lang="ru">
<head><meta charset="utf-8"></head>
<body style="margin:0;padding:0;background:#0c0c12;font-family:system-ui,-apple-system,sans-serif;">
  <table role="presentation" width="100%" style="background:#0c0c12;padding:32px 16px;">
    <tr><td align="center">
      <table role="presentation" style="max-width:520px;background:#14141c;border-radius:20px;border:1px solid rgba(255,255,255,0.08);">
        <tr><td style="padding:28px;">
          <h1 style="margin:0;font-size:20px;font-weight:700;color:#fafafa;">${escapeHtml(subject)}</h1>
          <p style="margin:16px 0 0 0;font-size:15px;line-height:1.55;color:#a1a1aa;">
            Вы успешно передали управление организацией <strong style="color:#e4e4e7;">${safeOrg}</strong>
            пользователю <strong style="color:#e4e4e7;">${safeNew}</strong>.
          </p>
          <p style="margin:12px 0 0 0;font-size:15px;line-height:1.55;color:#a1a1aa;">
            Ваш доступ к этой организации и её проектам <strong style="color:#e4e4e7;">завершён</strong>.
          </p>
          <p style="margin:12px 0 0 0;font-size:13px;color:#71717a;">Дата передачи: ${safeDate}</p>
          <p style="margin:24px 0 0 0;font-size:13px;line-height:1.5;color:#71717a;">
            Если у вас есть другие организации, вы можете открыть BoardIQ:
          </p>
          <p style="margin:12px 0 0 0;" align="center">
            <a href="${safeAppLink}" style="display:inline-block;padding:12px 24px;background:#34d399;color:#042f2e !important;text-decoration:none;font-weight:700;border-radius:12px;">
              Открыть BoardIQ
            </a>
          </p>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;

  try {
    await transporter.sendMail({
      from: `"BoardIQ" <${from}>`,
      to: params.to,
      subject,
      text,
      html,
    });
    return { ok: true };
  } catch (e) {
    console.error("[org-transfer-email] completed sendMail", e);
    return { ok: false, error: "send_failed" };
  }
}
