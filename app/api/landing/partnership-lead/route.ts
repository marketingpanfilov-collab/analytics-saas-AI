import nodemailer from "nodemailer";
import { NextResponse } from "next/server";

import { collaborationLabel, isValidCollaborationId } from "@/app/lib/landing/partnershipTypes";

export const runtime = "nodejs";

const DEFAULT_TO = "marketing.panfilov@gmail.com";

type Body = {
  name?: string;
  company?: string;
  website?: string;
  email?: string;
  phone?: string;
  collaborationType?: string;
};

function isNonEmpty(s: unknown): s is string {
  return typeof s === "string" && s.trim().length > 0;
}

function escapeHtml(s: string) {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function getTransporter() {
  const host = process.env.SMTP_HOST;
  const user = process.env.SMTP_USER;
  const pass = process.env.SMTP_PASS;
  const port = Number(process.env.SMTP_PORT || "465");
  if (!host || !user || !pass) return null;
  return nodemailer.createTransport({
    host,
    port,
    secure: port === 465,
    auth: { user, pass },
  });
}

/**
 * Заявка партнёра с лендинга — письмо на PARTNERSHIP_LEAD_TO (по умолчанию marketing.panfilov@gmail.com).
 * Нужны SMTP_* в .env (например Gmail с паролем приложения).
 */
export async function POST(req: Request) {
  let json: Body;
  try {
    json = (await req.json()) as Body;
  } catch {
    return NextResponse.json({ ok: false, error: "invalid_json" }, { status: 400 });
  }

  if (!isNonEmpty(json.name)) {
    return NextResponse.json({ ok: false, error: "name_required" }, { status: 400 });
  }
  if (!isNonEmpty(json.company)) {
    return NextResponse.json({ ok: false, error: "company_required" }, { status: 400 });
  }
  if (!isNonEmpty(json.website)) {
    return NextResponse.json({ ok: false, error: "website_required" }, { status: 400 });
  }
  if (!isNonEmpty(json.email) || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(json.email.trim())) {
    return NextResponse.json({ ok: false, error: "email_invalid" }, { status: 400 });
  }
  if (!isNonEmpty(json.phone)) {
    return NextResponse.json({ ok: false, error: "phone_required" }, { status: 400 });
  }
  if (!isNonEmpty(json.collaborationType)) {
    return NextResponse.json({ ok: false, error: "collaboration_required" }, { status: 400 });
  }
  if (!isValidCollaborationId(json.collaborationType)) {
    return NextResponse.json({ ok: false, error: "collaboration_invalid" }, { status: 400 });
  }

  const collaborationId = json.collaborationType;
  const collabLabel = collaborationLabel(collaborationId);

  const payload = {
    name: json.name.trim(),
    company: json.company.trim(),
    website: json.website.trim(),
    email: json.email.trim(),
    phone: json.phone.trim(),
    collaborationType: collaborationId,
    collaborationLabel: collabLabel,
    at: new Date().toISOString(),
  };

  const to = (process.env.PARTNERSHIP_LEAD_TO || DEFAULT_TO).trim();

  const transporter = getTransporter();
  if (!transporter) {
    if (process.env.NODE_ENV === "development") {
      console.warn(
        "[partnership-lead] SMTP не настроен — письмо не отправлено. Добавьте SMTP_HOST, SMTP_USER, SMTP_PASS в .env. Заявка:",
        payload
      );
      return NextResponse.json({ ok: true, dev: true });
    }
    return NextResponse.json({ ok: false, error: "smtp_not_configured" }, { status: 503 });
  }

  const from = process.env.SMTP_FROM || process.env.SMTP_USER || "noreply@localhost";
  const subject = `BoardIQ — партнёрская заявка: ${collabLabel} (${payload.company})`;

  const text = [
    `Новая заявка с лендинга BoardIQ`,
    ``,
    `Вид сотрудничества: ${collabLabel}`,
    `Имя: ${payload.name}`,
    `Компания: ${payload.company}`,
    `Сайт: ${payload.website}`,
    `Email: ${payload.email}`,
    `Телефон: ${payload.phone}`,
    ``,
    `Время (UTC): ${payload.at}`,
  ].join("\n");

  const html = `
  <div style="font-family:system-ui,sans-serif;line-height:1.5;color:#111">
    <h2 style="margin:0 0 12px">Новая заявка с лендинга BoardIQ</h2>
    <table style="border-collapse:collapse">
      <tr><td style="padding:4px 12px 4px 0;color:#555">Вид сотрудничества</td><td><strong>${escapeHtml(collabLabel)}</strong></td></tr>
      <tr><td style="padding:4px 12px 4px 0;color:#555">Имя</td><td>${escapeHtml(payload.name)}</td></tr>
      <tr><td style="padding:4px 12px 4px 0;color:#555">Компания</td><td>${escapeHtml(payload.company)}</td></tr>
      <tr><td style="padding:4px 12px 4px 0;color:#555">Сайт</td><td>${escapeHtml(payload.website)}</td></tr>
      <tr><td style="padding:4px 12px 4px 0;color:#555">Email</td><td><a href="mailto:${escapeHtml(payload.email)}">${escapeHtml(payload.email)}</a></td></tr>
      <tr><td style="padding:4px 12px 4px 0;color:#555">Телефон</td><td>${escapeHtml(payload.phone)}</td></tr>
    </table>
    <p style="margin-top:16px;font-size:12px;color:#888">${escapeHtml(payload.at)}</p>
  </div>`;

  try {
    await transporter.sendMail({
      from: `"BoardIQ" <${from}>`,
      to,
      replyTo: payload.email,
      subject,
      text,
      html,
    });
  } catch (e) {
    console.error("[partnership-lead] sendMail", e);
    return NextResponse.json({ ok: false, error: "send_failed" }, { status: 502 });
  }

  return NextResponse.json({ ok: true });
}
