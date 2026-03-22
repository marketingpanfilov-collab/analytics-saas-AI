import { randomUUID } from "crypto";
import { NextResponse } from "next/server";

const ADMIN_EMAIL = "marketing.panfilov@gmail.com";

const REQUEST_TYPE_LABELS: Record<string, string> = {
  account: "Удаление аккаунта",
  personal: "Удаление персональных данных",
  integrations: "Удаление данных интеграций",
  withdraw: "Отзыв согласия на обработку",
};

const INTEGRATION_LABELS: Record<string, string> = {
  "": "Не применимо / не выбрано",
  meta: "Meta",
  google: "Google",
  tiktok: "TikTok",
  yandex: "Яндекс",
  other: "Другое",
};

function isValidEmail(s: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s.trim());
}

async function sendResendEmail(params: { to: string; subject: string; text: string }) {
  const key = process.env.RESEND_API_KEY;
  if (!key) {
    throw new Error("RESEND_API_KEY is not configured");
  }
  const from =
    process.env.RESEND_FROM_EMAIL?.trim() ||
    "BoardIQ <onboarding@resend.dev>";

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
    }),
  });

  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`Resend API error: ${res.status} ${errText}`);
  }
}

export async function POST(request: Request) {
  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const contactEmail = typeof body.contactEmail === "string" ? body.contactEmail.trim() : "";
  const requestType = typeof body.requestType === "string" ? body.requestType.trim() : "";

  if (!contactEmail || !isValidEmail(contactEmail)) {
    return NextResponse.json({ error: "Invalid email" }, { status: 400 });
  }

  if (!requestType || !REQUEST_TYPE_LABELS[requestType]) {
    return NextResponse.json({ error: "Invalid requestType" }, { status: 400 });
  }

  const requestId = randomUUID();
  const date = new Date().toLocaleString("ru-RU", {
    dateStyle: "long",
    timeStyle: "short",
  });

  const fullName = typeof body.fullName === "string" ? body.fullName.trim() : "";
  const accountEmail = typeof body.accountEmail === "string" ? body.accountEmail.trim() : "";
  const phone = typeof body.phone === "string" ? body.phone.trim() : "";
  const integration = typeof body.integration === "string" ? body.integration : "";
  const description = typeof body.description === "string" ? body.description.trim() : "";

  const privacyContact =
    process.env.PRIVACY_CONTACT_EMAIL?.trim() || "privacy@boardiq.kz";

  const userSubject = "Ваш запрос на удаление данных принят в обработку";
  const userText = `Здравствуйте.

Мы получили ваш запрос на удаление данных и приняли его в обработку.

Номер запроса: ${requestId}
Дата получения: ${date}

При необходимости мы можем дополнительно запросить сведения для подтверждения личности или полномочий заявителя.

Обращаем внимание, что удаление отдельных данных может занять дополнительное время, если такие данные подлежат обязательному хранению в соответствии с законодательством Республики Казахстан либо находятся в резервных копиях, кэше, журналах событий или иных технических системах в пределах штатного цикла обработки и очистки.

Если у вас есть дополнительные вопросы, пожалуйста, свяжитесь с нами:
${privacyContact}

С уважением,
Команда BoardIQ`;

  const adminSubject = "Новый запрос на удаление данных";
  const adminText = `Новый запрос на удаление данных:

Номер запроса: ${requestId}
Дата: ${date}

ФИО: ${fullName || "—"}
Email: ${contactEmail}
Email аккаунта: ${accountEmail || "—"}
Телефон: ${phone || "—"}

Тип запроса: ${REQUEST_TYPE_LABELS[requestType] ?? requestType}
Интеграция: ${INTEGRATION_LABELS[integration] ?? (integration || "—")}

Описание:
${description || "—"}`;

  try {
    await sendResendEmail({
      to: contactEmail,
      subject: userSubject,
      text: userText,
    });
    await sendResendEmail({
      to: ADMIN_EMAIL,
      subject: adminSubject,
      text: adminText,
    });
  } catch (err) {
    console.error("[data-deletion] email error:", err);
    return NextResponse.json(
      { error: "Не удалось отправить письмо. Проверьте настройки RESEND_API_KEY." },
      { status: 502 }
    );
  }

  return NextResponse.json({ success: true, requestId });
}
