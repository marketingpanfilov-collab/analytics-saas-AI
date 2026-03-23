"use client";

import { FormEvent, useState } from "react";

type Status = "idle" | "loading" | "success" | "error";

export function RefundRequestForm() {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [orderRef, setOrderRef] = useState("");
  const [reason, setReason] = useState("");
  const [status, setStatus] = useState<Status>("idle");
  const [msg, setMsg] = useState("");

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (status === "loading") return;

    setMsg("");
    if (!name.trim()) {
      setMsg("Укажите имя.");
      setStatus("error");
      return;
    }
    if (!email.trim()) {
      setMsg("Укажите email.");
      setStatus("error");
      return;
    }
    if (!reason.trim()) {
      setMsg("Опишите причину возврата.");
      setStatus("error");
      return;
    }

    setStatus("loading");
    try {
      const res = await fetch("/api/refund-request", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: name.trim(),
          email: email.trim(),
          phone: phone.trim(),
          orderRef: orderRef.trim(),
          reason: reason.trim(),
        }),
      });

      const json = (await res.json().catch(() => ({}))) as { ok?: boolean; error?: string };
      if (!res.ok || !json.ok) {
        setStatus("error");
        setMsg("Не удалось отправить заявку. Попробуйте еще раз.");
        return;
      }

      setStatus("success");
      setMsg("Заявка отправлена. Мы свяжемся с вами по указанному email.");
      setName("");
      setEmail("");
      setPhone("");
      setOrderRef("");
      setReason("");
    } catch {
      setStatus("error");
      setMsg("Не удалось отправить заявку. Проверьте соединение и попробуйте снова.");
    }
  }

  const inputClass =
    "mt-2 w-full rounded-xl border border-white/10 bg-white/[0.04] px-4 py-3 text-sm text-white placeholder-zinc-500 focus:border-white/20 focus:outline-none";

  return (
    <form onSubmit={onSubmit} className="mt-6 space-y-4">
      <div className="grid gap-4 md:grid-cols-2">
        <div>
          <label className="block text-sm font-medium text-zinc-300" htmlFor="refund-name">
            Имя *
          </label>
          <input
            id="refund-name"
            className={inputClass}
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Иван Иванов"
            autoComplete="name"
          />
        </div>

        <div>
          <label className="block text-sm font-medium text-zinc-300" htmlFor="refund-email">
            Email *
          </label>
          <input
            id="refund-email"
            type="email"
            className={inputClass}
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="you@example.com"
            autoComplete="email"
          />
        </div>
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <div>
          <label className="block text-sm font-medium text-zinc-300" htmlFor="refund-phone">
            Телефон
          </label>
          <input
            id="refund-phone"
            className={inputClass}
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            placeholder="+7 777 000 00 00"
            autoComplete="tel"
          />
        </div>

        <div>
          <label className="block text-sm font-medium text-zinc-300" htmlFor="refund-order-ref">
            Номер заказа / платежа
          </label>
          <input
            id="refund-order-ref"
            className={inputClass}
            value={orderRef}
            onChange={(e) => setOrderRef(e.target.value)}
            placeholder="Например, INV-2026-001"
          />
        </div>
      </div>

      <div>
        <label className="block text-sm font-medium text-zinc-300" htmlFor="refund-reason">
          Причина возврата *
        </label>
        <textarea
          id="refund-reason"
          className={`${inputClass} min-h-[120px] resize-y`}
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          placeholder="Опишите, по какой причине вы хотите оформить возврат."
        />
      </div>

      <button
        type="submit"
        disabled={status === "loading"}
        className="inline-flex h-11 cursor-pointer items-center rounded-xl bg-white/10 px-6 text-sm font-medium text-white hover:bg-white/15 disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-50"
      >
        {status === "loading" ? "Отправка..." : "Отправить заявку"}
      </button>

      {msg ? (
        <p
          className={
            status === "success"
              ? "rounded-xl border border-emerald-500/30 bg-emerald-500/10 px-4 py-3 text-sm text-emerald-200"
              : "rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-300"
          }
        >
          {msg}
        </p>
      ) : null}
    </form>
  );
}
