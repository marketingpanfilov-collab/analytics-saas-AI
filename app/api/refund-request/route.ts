import nodemailer from "nodemailer";
import { NextResponse } from "next/server";

export const runtime = "nodejs";

const DEFAULT_TO = "marketing.panfilov@gmail.com";

type Body = {
  name?: string;
  email?: string;
  phone?: string;
  orderRef?: string;
  reason?: string;
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
  if (!isNonEmpty(json.email) || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(json.email.trim())) {
    return NextResponse.json({ ok: false, error: "email_invalid" }, { status: 400 });
  }
  if (!isNonEmpty(json.reason)) {
    return NextResponse.json({ ok: false, error: "reason_required" }, { status: 400 });
  }

  const payload = {
    name: json.name.trim(),
    email: json.email.trim(),
    phone: isNonEmpty(json.phone) ? json.phone.trim() : "",
    orderRef: isNonEmpty(json.orderRef) ? json.orderRef.trim() : "",
    reason: json.reason.trim(),
    at: new Date().toISOString(),
  };

  const to = (process.env.REFUND_REQUEST_TO || DEFAULT_TO).trim();
  const transporter = getTransporter();

  if (!transporter) {
    if (process.env.NODE_ENV === "development") {
      console.warn(
        "[refund-request] SMTP не настроен — письмо не отправлено. Добавьте SMTP_HOST, SMTP_USER, SMTP_PASS в .env. Заявка:",
        payload
      );
      return NextResponse.json({ ok: true, dev: true });
    }
    return NextResponse.json({ ok: false, error: "smtp_not_configured" }, { status: 503 });
  }

  const from = process.env.SMTP_FROM || process.env.SMTP_USER || "noreply@localhost";
  const subject = `BoardIQ — заявка на возврат (${payload.name})`;
  const text = [
    "Новая заявка на возврат",
    "",
    `Имя: ${payload.name}`,
    `Email: ${payload.email}`,
    `Телефон: ${payload.phone || "—"}`,
    `Номер заказа/платежа: ${payload.orderRef || "—"}`,
    "",
    "Причина:",
    payload.reason,
    "",
    `Время (UTC): ${payload.at}`,
  ].join("\n");

  const html = `
  <div style="font-family:system-ui,sans-serif;line-height:1.5;color:#111">
    <h2 style="margin:0 0 12px">Новая заявка на возврат</h2>
    <table style="border-collapse:collapse">
      <tr><td style="padding:4px 12px 4px 0;color:#555">Имя</td><td>${escapeHtml(payload.name)}</td></tr>
      <tr><td style="padding:4px 12px 4px 0;color:#555">Email</td><td><a href="mailto:${escapeHtml(payload.email)}">${escapeHtml(payload.email)}</a></td></tr>
      <tr><td style="padding:4px 12px 4px 0;color:#555">Телефон</td><td>${escapeHtml(payload.phone || "—")}</td></tr>
      <tr><td style="padding:4px 12px 4px 0;color:#555">Номер заказа/платежа</td><td>${escapeHtml(payload.orderRef || "—")}</td></tr>
    </table>
    <h3 style="margin:16px 0 6px">Причина</h3>
    <p style="white-space:pre-wrap;margin:0">${escapeHtml(payload.reason)}</p>
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
    console.error("[refund-request] sendMail", e);
    return NextResponse.json({ ok: false, error: "send_failed" }, { status: 502 });
  }

  return NextResponse.json({ ok: true });
}
