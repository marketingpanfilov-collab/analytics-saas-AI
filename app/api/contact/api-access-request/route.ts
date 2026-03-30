import nodemailer from "nodemailer";
import { NextResponse } from "next/server";

import { checkRateLimit, getRequestIp } from "@/app/lib/security/rateLimit";

export const runtime = "nodejs";

const DEFAULT_TO = "marketing.panfilov@gmail.com";

const CALL_VOLUME_IDS = ["lt_10k", "10k_100k", "100k_1m", "gt_1m", "unknown"] as const;
type CallVolumeId = (typeof CALL_VOLUME_IDS)[number];

const CALL_VOLUME_LABEL: Record<CallVolumeId, string> = {
  lt_10k: "до 10 000 вызовов в месяц",
  "10k_100k": "10 000 – 100 000 в месяц",
  "100k_1m": "100 000 – 1 000 000 в месяц",
  gt_1m: "более 1 000 000 в месяц",
  unknown: "пока не определились",
};

type Body = {
  name?: string;
  phone?: string;
  callVolume?: string;
  description?: string;
  projectId?: string;
  projectName?: string;
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

async function sendViaResend(params: {
  to: string;
  subject: string;
  text: string;
  html: string;
}) {
  const key = process.env.RESEND_API_KEY?.trim();
  if (!key) return false;
  const from = process.env.RESEND_FROM_EMAIL?.trim() || "BoardIQ <onboarding@resend.dev>";
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from,
      to: [params.to],
      subject: params.subject,
      text: params.text,
      html: params.html,
    }),
  });

  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`Resend API error: ${res.status} ${errText}`);
  }
  return true;
}

function isCallVolumeId(v: string): v is CallVolumeId {
  return (CALL_VOLUME_IDS as readonly string[]).includes(v);
}

export async function POST(req: Request) {
  const ip = getRequestIp(req);
  const rl = await checkRateLimit(`public:api-access-request:${ip}`, 5, 60_000);
  if (!rl.ok) {
    return NextResponse.json(
      { ok: false, error: `rate_limited_${rl.retryAfterSec}s` },
      { status: 429 }
    );
  }

  let json: Body;
  try {
    json = (await req.json()) as Body;
  } catch {
    return NextResponse.json({ ok: false, error: "invalid_json" }, { status: 400 });
  }

  if (!isNonEmpty(json.name) || json.name.trim().length > 200) {
    return NextResponse.json({ ok: false, error: "name_invalid" }, { status: 400 });
  }
  if (!isNonEmpty(json.phone) || json.phone.trim().length > 80) {
    return NextResponse.json({ ok: false, error: "phone_invalid" }, { status: 400 });
  }
  if (!isNonEmpty(json.callVolume) || !isCallVolumeId(json.callVolume.trim())) {
    return NextResponse.json({ ok: false, error: "call_volume_invalid" }, { status: 400 });
  }
  const desc = typeof json.description === "string" ? json.description.trim() : "";
  if (desc.length < 20 || desc.length > 8000) {
    return NextResponse.json({ ok: false, error: "description_invalid" }, { status: 400 });
  }

  const callVolumeId = json.callVolume.trim() as CallVolumeId;
  const callVolumeLabel = CALL_VOLUME_LABEL[callVolumeId];

  const projectId = typeof json.projectId === "string" ? json.projectId.trim().slice(0, 128) : "";
  const projectName =
    typeof json.projectName === "string" ? json.projectName.trim().slice(0, 300) : "";

  const payload = {
    name: json.name.trim(),
    phone: json.phone.trim(),
    callVolumeId,
    callVolumeLabel,
    description: desc,
    projectId: projectId || undefined,
    projectName: projectName || undefined,
    at: new Date().toISOString(),
  };

  const to = (process.env.API_ACCESS_REQUEST_TO || DEFAULT_TO).trim();

  const transporter = getTransporter();
  const smtpFrom = process.env.SMTP_FROM || process.env.SMTP_USER || "noreply@localhost";
  const subject = `BoardIQ — заявка на доступ к API: ${payload.name}`;

  const text = [
    `Заявка на доступ к API (настройки приложения)`,
    ``,
    `Имя: ${payload.name}`,
    `Телефон: ${payload.phone}`,
    `Ожидаемый объём вызовов: ${payload.callVolumeLabel}`,
    payload.projectId ? `ID проекта: ${payload.projectId}` : null,
    payload.projectName ? `Название проекта: ${payload.projectName}` : null,
    ``,
    `Для чего нужен API:`,
    payload.description,
    ``,
    `Время (UTC): ${payload.at}`,
  ]
    .filter(Boolean)
    .join("\n");

  const descHtml = escapeHtml(payload.description).replace(/\r\n/g, "\n").replace(/\n/g, "<br/>");

  const html = `
  <div style="font-family:system-ui,sans-serif;line-height:1.5;color:#111">
    <h2 style="margin:0 0 12px">Заявка на доступ к API</h2>
    <table style="border-collapse:collapse">
      <tr><td style="padding:4px 12px 4px 0;color:#555">Имя</td><td><strong>${escapeHtml(payload.name)}</strong></td></tr>
      <tr><td style="padding:4px 12px 4px 0;color:#555">Телефон</td><td>${escapeHtml(payload.phone)}</td></tr>
      <tr><td style="padding:4px 12px 4px 0;color:#555;vertical-align:top">Объём вызовов</td><td>${escapeHtml(payload.callVolumeLabel)}</td></tr>
      ${payload.projectId ? `<tr><td style="padding:4px 12px 4px 0;color:#555">ID проекта</td><td>${escapeHtml(payload.projectId)}</td></tr>` : ""}
      ${payload.projectName ? `<tr><td style="padding:4px 12px 4px 0;color:#555">Проект</td><td>${escapeHtml(payload.projectName)}</td></tr>` : ""}
    </table>
    <p style="margin:16px 0 6px;font-weight:600">Для чего нужен API</p>
    <div style="white-space:pre-wrap;border:1px solid #eee;padding:12px;border-radius:8px;background:#fafafa;font-size:14px">${descHtml}</div>
    <p style="margin-top:16px;font-size:12px;color:#888">${escapeHtml(payload.at)}</p>
  </div>`;

  try {
    if (transporter) {
      await transporter.sendMail({
        from: `"BoardIQ" <${smtpFrom}>`,
        to,
        subject,
        text,
        html,
      });
    } else {
      const sent = await sendViaResend({
        to,
        subject,
        text,
        html,
      });
      if (!sent) {
        return NextResponse.json({ ok: false, error: "smtp_not_configured" }, { status: 503 });
      }
    }
  } catch (e) {
    console.error("[api-access-request] sendMail", e);
    try {
      const sentViaResend = await sendViaResend({
        to,
        subject,
        text,
        html,
      });
      if (sentViaResend) return NextResponse.json({ ok: true, provider: "resend_fallback" });
    } catch (fallbackErr) {
      console.error("[api-access-request] resend fallback", fallbackErr);
    }
    return NextResponse.json({ ok: false, error: "send_failed" }, { status: 502 });
  }

  return NextResponse.json({ ok: true });
}
