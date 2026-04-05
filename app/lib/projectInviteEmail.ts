import nodemailer from "nodemailer";

const ROLE_LABELS_RU: Record<string, string> = {
  project_admin: "Администратор проекта",
  marketer: "Маркетолог",
  viewer: "Наблюдатель",
};

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

export type SendProjectInviteEmailParams = {
  to: string;
  inviteUrl: string;
  projectName: string;
  organizationName: string;
  roleKey: string;
  inviterEmail: string | null;
  inviterDisplayName: string | null;
  expiresAtIso: string;
};

export async function sendProjectInviteEmail(
  params: SendProjectInviteEmailParams
): Promise<{ ok: true } | { ok: false; error: string }> {
  const transporter = getTransporter();
  if (!transporter) {
    return { ok: false, error: "smtp_not_configured" };
  }

  const from =
    process.env.SMTP_FROM?.trim() ||
    process.env.RESEND_FROM_EMAIL?.trim() ||
    process.env.SMTP_USER ||
    "noreply@localhost";
  const roleLabel = ROLE_LABELS_RU[params.roleKey] ?? params.roleKey;
  const exp = new Date(params.expiresAtIso);
  const expiresRu = Number.isFinite(exp.getTime())
    ? exp.toLocaleString("ru-RU", { day: "numeric", month: "long", year: "numeric", hour: "2-digit", minute: "2-digit" })
    : params.expiresAtIso;

  const inviterLine =
    params.inviterDisplayName || params.inviterEmail
      ? [params.inviterDisplayName, params.inviterEmail ? `(${params.inviterEmail})` : ""].filter(Boolean).join(" ")
      : "участник вашей команды";

  const subject = `Приглашение в проект «${params.projectName}» — BoardIQ`;

  const safeProject = escapeHtml(params.projectName);
  const safeOrg = escapeHtml(params.organizationName);
  const safeRole = escapeHtml(roleLabel);
  const safeInviter = escapeHtml(inviterLine);
  const safeExpires = escapeHtml(expiresRu);
  const safeUrl = escapeHtml(params.inviteUrl);

  const text = [
    `Вас пригласили в проект «${params.projectName}» (${params.organizationName}) в BoardIQ.`,
    "",
    `Роль: ${roleLabel}`,
    `Пригласил(а): ${inviterLine}`,
    `Ссылка действует до: ${expiresRu}`,
    "",
    "Принять приглашение:",
    params.inviteUrl,
    "",
    "Если кнопка не работает, скопируйте ссылку выше в браузер.",
  ].join("\n");

  const html = `
<!DOCTYPE html>
<html lang="ru">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${escapeHtml(subject)}</title>
</head>
<body style="margin:0;padding:0;background:#0c0c12;font-family:system-ui,-apple-system,'Segoe UI',Roboto,sans-serif;">
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#0c0c12;padding:32px 16px;">
    <tr>
      <td align="center">
        <table role="presentation" width="100%" style="max-width:520px;background:linear-gradient(180deg,#14141c 0%,#101018 100%);border-radius:20px;border:1px solid rgba(255,255,255,0.08);overflow:hidden;box-shadow:0 24px 48px rgba(0,0,0,0.45);">
          <tr>
            <td style="padding:28px 28px 8px 28px;">
              <p style="margin:0;font-size:13px;font-weight:600;letter-spacing:0.12em;text-transform:uppercase;color:#34d399;">BoardIQ</p>
              <h1 style="margin:12px 0 0 0;font-size:22px;font-weight:700;line-height:1.3;color:#fafafa;">Приглашение в проект</h1>
            </td>
          </tr>
          <tr>
            <td style="padding:8px 28px 20px 28px;">
              <p style="margin:0 0 8px 0;font-size:15px;line-height:1.55;color:#a1a1aa;">
                Вас пригласили работать в аналитическом проекте
              </p>
              <p style="margin:0;font-size:20px;font-weight:700;line-height:1.35;color:#f4f4f5;">${safeProject}</p>
              <p style="margin:10px 0 0 0;font-size:14px;color:#71717a;">
                Организация: <span style="color:#d4d4d8;">${safeOrg}</span>
              </p>
              <table role="presentation" cellspacing="0" cellpadding="0" style="margin-top:20px;width:100%;border-collapse:separate;border-spacing:0;">
                <tr>
                  <td style="padding:14px 16px;background:rgba(255,255,255,0.04);border-radius:12px;border:1px solid rgba(255,255,255,0.06);">
                    <p style="margin:0 0 4px 0;font-size:11px;text-transform:uppercase;letter-spacing:0.06em;color:#71717a;">Роль в проекте</p>
                    <p style="margin:0;font-size:15px;font-weight:600;color:#e4e4e7;">${safeRole}</p>
                  </td>
                </tr>
              </table>
              <p style="margin:18px 0 0 0;font-size:13px;line-height:1.5;color:#a1a1aa;">
                Пригласил(а): <span style="color:#e4e4e7;">${safeInviter}</span>
              </p>
              <p style="margin:8px 0 0 0;font-size:13px;color:#fbbf24;">
                Ссылка действует до: ${safeExpires}
              </p>
            </td>
          </tr>
          <tr>
            <td style="padding:8px 28px 28px 28px;" align="center">
              <a href="${safeUrl}" style="display:inline-block;padding:14px 32px;background:linear-gradient(180deg,#34d399 0%,#10b981 100%);color:#042f2e !important;text-decoration:none;font-weight:700;font-size:15px;border-radius:12px;box-shadow:0 4px 14px rgba(16,185,129,0.35);">
                Принять приглашение
              </a>
              <p style="margin:20px 0 0 0;font-size:12px;line-height:1.5;color:#52525b;max-width:420px;">
                Если кнопка не открывается, скопируйте ссылку в браузер:<br/>
                <a href="${safeUrl}" style="color:#34d399;word-break:break-all;">${safeUrl}</a>
              </p>
            </td>
          </tr>
        </table>
        <p style="margin:24px 0 0 0;font-size:11px;color:#52525b;max-width:480px;text-align:center;">
          Вы получили это письмо, потому что вас пригласили в BoardIQ. Если это не вы — проигнорируйте письмо.
        </p>
      </td>
    </tr>
  </table>
</body>
</html>`;

  try {
    await transporter.sendMail({
      from: `"BoardIQ" <${from}>`,
      to: params.to,
      replyTo: params.inviterEmail || undefined,
      subject,
      text,
      html,
    });
    return { ok: true };
  } catch (e) {
    console.error("[project-invite-email] sendMail", e);
    return { ok: false, error: "send_failed" };
  }
}
