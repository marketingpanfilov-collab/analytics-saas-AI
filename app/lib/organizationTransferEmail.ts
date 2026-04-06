import nodemailer from "nodemailer";
import {
  buildBoardiqTransactionalEmailHtml,
  escapeHtmlForEmail,
} from "./email/boardiqEmailShell";

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

/** Письмо получателю: тот же визуал, что у auth-шаблонов BoardIQ. */
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

  const subject = "Вам предоставлен доступ — BoardIQ";
  const safeOrg = escapeHtmlForEmail(params.organizationName);

  const text = [
    `Вам выдан доступ к организации «${params.organizationName}» в BoardIQ.`,
    "",
    `Ссылка действует до: ${expiresRu}`,
    "",
    "Открыть BoardIQ:",
    params.acceptUrl,
    "",
    "Если кнопка в письме не работает, скопируйте ссылку выше в браузер.",
  ].join("\n");

  const bodyHtml = `
    <p style="color:#a1a1aa;font-size:14px;line-height:1.6;margin:0 0 12px;">
      Вам выдан доступ к организации или проекту.
    </p>
    <p style="color:#a1a1aa;font-size:14px;line-height:1.6;margin:0 0 20px;">
      Организация: <span style="color:#e4e4e7;">${safeOrg}</span>
    </p>`;

  const html = buildBoardiqTransactionalEmailHtml({
    title: "Доступ предоставлен",
    bodyHtml,
    ctaLabel: "Открыть BoardIQ",
    actionUrl: params.acceptUrl,
    midNote: `Ссылка действует до: ${expiresRu}. Если вы не ожидали письма, проигнорируйте его.`,
  });

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
  const safeOrg = escapeHtmlForEmail(params.organizationName);
  const safeNew = escapeHtmlForEmail(params.newOwnerEmail);
  const safeDate = escapeHtmlForEmail(dateRu);
  const appLink = `${params.appUrl.replace(/\/$/, "")}/app/projects`;

  const text = [
    `Вы успешно передали управление организацией «${params.organizationName}» пользователю ${params.newOwnerEmail}.`,
    `Ваш доступ к этой организации и её проектам завершён.`,
    "",
    `Дата передачи: ${dateRu}`,
    "",
    "Если у вас есть другие организации в BoardIQ, вы можете открыть приложение:",
    appLink,
  ].join("\n");

  const bodyHtml = `
    <p style="color:#a1a1aa;font-size:14px;line-height:1.6;margin:0 0 12px;">
      Вы успешно передали управление организацией <span style="color:#e4e4e7;">${safeOrg}</span>
      пользователю <span style="color:#e4e4e7;">${safeNew}</span>.
    </p>
    <p style="color:#a1a1aa;font-size:14px;line-height:1.6;margin:0 0 20px;">
      Ваш доступ к этой организации и её проектам <span style="color:#e4e4e7;">завершён</span>.<br/>
      Дата передачи: <span style="color:#e4e4e7;">${safeDate}</span>
    </p>`;

  const html = buildBoardiqTransactionalEmailHtml({
    title: "Передача завершена",
    bodyHtml,
    ctaLabel: "Открыть BoardIQ",
    actionUrl: appLink,
    midNote:
      "Если у вас есть другие организации в BoardIQ, откройте приложение по кнопке выше.",
  });

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
