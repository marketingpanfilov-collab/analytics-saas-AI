import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/app/lib/supabaseAdmin";
import { normalizePlanId } from "@/lib/billing/plans";

type RegisterBody = {
  name?: string;
  email?: string;
  password?: string;
  plan?: string;
};

function isValidEmail(email: string) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

export async function POST(req: Request) {
  try {
    const body = (await req.json()) as RegisterBody;
    const name = (body.name ?? "").trim();
    const email = (body.email ?? "").trim().toLowerCase();
    const password = body.password ?? "";
    const normalizedPlan = normalizePlanId(body.plan ?? null);

    if (!email || !password) {
      return NextResponse.json({ error: "Email и пароль обязательны" }, { status: 400 });
    }
    if (!isValidEmail(email)) {
      return NextResponse.json({ error: "Некорректный email" }, { status: 400 });
    }
    if (password.length < 8) {
      return NextResponse.json({ error: "Пароль должен быть не менее 8 символов" }, { status: 400 });
    }
    if (!normalizedPlan) {
      return NextResponse.json({ error: "Невалидный тариф" }, { status: 400 });
    }

    const admin = supabaseAdmin();
    const { data, error } = await admin.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      user_metadata: {
        name: name || null,
        selected_plan: normalizedPlan,
      },
    });

    if (error || !data.user) {
      const message =
        error?.message?.includes("already been registered") || error?.message?.includes("already exists")
          ? "Пользователь с таким email уже существует"
          : error?.message || "Не удалось зарегистрировать пользователя";
      return NextResponse.json({ error: message }, { status: 400 });
    }

    return NextResponse.json({
      success: true,
      user: {
        id: data.user.id,
        email: data.user.email,
      },
    });
  } catch {
    return NextResponse.json({ error: "Некорректное тело запроса" }, { status: 400 });
  }
}
