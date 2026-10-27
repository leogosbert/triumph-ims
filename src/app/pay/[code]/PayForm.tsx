"use client";

import { useState, useTransition } from "react";
import { useTr } from "@/lib/tr-client";
import { startPayment } from "./actions";

/** Phone (and amount, when part payments are allowed) → the gateway's checkout page. */
export function PayForm({ code, balance, currency, allowPartial, methods }: { code: string; balance: number; currency: string; allowPartial: boolean; methods: string[] }) {
  const t = useTr();
  const [phone, setPhone] = useState("");
  const [amount, setAmount] = useState(String(Math.round(balance)));
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  return (
    <form
      className="pay-form"
      onSubmit={(e) => {
        e.preventDefault();
        setError(null);
        start(async () => {
          const r = await startPayment(code, phone, allowPartial ? amount : "");
          if (r.ok) window.location.assign(r.url);
          else setError(r.error);
        });
      }}
    >
      <label className="field">
        <span>{t("Phone number that will pay")}</span>
        <input type="tel" inputMode="tel" autoComplete="tel" required placeholder="0754 123 456" value={phone} onChange={(e) => setPhone(e.target.value)} />
      </label>
      {allowPartial ? (
        <label className="field">
          <span>
            {t("Amount")} ({currency})
          </span>
          <input inputMode="numeric" required value={amount} onChange={(e) => setAmount(e.target.value)} />
        </label>
      ) : null}
      {error ? (
        <p className="notice notice-error" role="alert">
          {t(error)}
        </p>
      ) : null}
      <button className="btn btn-primary" type="submit" disabled={pending} style={{ width: "100%" }}>
        {pending ? t("Opening the payment page…") : t("Pay now")}
      </button>
      <p className="small muted">{methods.join(" · ")}</p>
    </form>
  );
}
