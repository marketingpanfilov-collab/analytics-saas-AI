import nodemailer from "nodemailer";
import {
  buildBoardiqTransactionalEmailHtml,
  escapeHtmlForEmail,
} from "./email/boardiqEmailShell";

const ROLE_LABELS_RU: Record<string, string> = {
  project_admin: "Администратор проекта",
  marketer: "Маркетолог",
  viewer: "Наблюдатель",
};

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
    ? exp.toLocaleString("ru-RU", {
        day: "numeric",
        month: "long",
        year: "numeric",
        hour: "2-digit",
        minute: "2-digit",
      })
    : params.expiresAtIso;

  const inviterLine =
    params.inviterDisplayName || params.inviterEmail
      ? [
          params.inviterDisplayName,
          params.inviterEmail ? `(${params.inviterEmail})` : "",
        ]
          .filter(Boolean)
          .join(" ")
      : "участник вашей команды";

  const subject = `Приглашение в проект «${params.projectName}» — BoardIQ`;

  const safeProject = escapeHtmlForEmail(params.projectName);
  const safeOrg = escapeHtmlForEmail(params.organizationName);
  const safeRole = escapeHtmlForEmail(roleLabel);
  const safeInviter = escapeHtmlForEmail(inviterLine);
  const safeExpires = escapeHtmlForEmail(expiresRu);

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

  const bodyHtml = `
    <p style="color:#d4d4d8 !important;-webkit-text-fill-color:#d4d4d8 !important;font-size:14px;line-height:1.6;margin:0 0 16px;">
      Вас пригласили присоединиться к команде в BoardIQ.
    </p>
    <p style="color:#d4d4d8 !important;-webkit-text-fill-color:#d4d4d8 !important;font-size:14px;line-height:1.6;margin:0 0 8px;">
      Проект: <span style="color:#f4f4f5 !important;-webkit-text-fill-color:#f4f4f5 !important;">${safeProject}</span>
    </p>
    <p style="color:#d4d4d8 !important;-webkit-text-fill-color:#d4d4d8 !important;font-size:14px;line-height:1.6;margin:0 0 20px;">
      Организация: <span style="color:#f4f4f5 !important;-webkit-text-fill-color:#f4f4f5 !important;">${safeOrg}</span><br/>
      Роль: <span style="color:#f4f4f5 !important;-webkit-text-fill-color:#f4f4f5 !important;">${safeRole}</span><br/>
      Пригласил(а): <span style="color:#f4f4f5 !important;-webkit-text-fill-color:#f4f4f5 !important;">${safeInviter}</span>
    </p>`;

  const html = buildBoardiqTransactionalEmailHtml({
    title: "Приглашение в проект",
    bodyHtml,
    ctaLabel: "Принять приглашение",
    actionUrl: params.inviteUrl,
    midNote: `Ссылка действует до: ${expiresRu}. Если вы не ожидали приглашения, проигнорируйте это письмо.`,
  });

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
