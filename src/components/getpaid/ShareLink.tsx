"use client";

import { useState } from "react";
import { useTr } from "@/lib/tr-client";

/** Copy / WhatsApp / email buttons for a pay link. */
export function ShareLink({ url, whatsappText, emailSubject, emailBody, phone, email }: { url: string; whatsappText: string; emailSubject: string; emailBody: string; phone: string | null; email: string | null }) {
  const t = useTr();
  const [copied, setCopied] = useState(false);
  const wa = `https://wa.me/${phone ?? ""}?text=${encodeURIComponent(whatsappText)}`;
  const mail = `mailto:${email ?? ""}?subject=${encodeURIComponent(emailSubject)}&body=${encodeURIComponent(emailBody)}`;
  return (
    <div className="row" style={{ gap: 8, flexWrap: "wrap", justifyContent: "flex-start" }}>
      <button
        type="button"
        className="btn btn-small"
        onClick={async () => {
          try {
            await navigator.clipboard.writeText(url);
            setCopied(true);
            setTimeout(() => setCopied(false), 2000);
          } catch {
            /* the link is shown on the page to copy by hand */
          }
        }}
      >
        {copied ? t("Copied") : t("Copy link")}
      </button>
      <a className="btn btn-small" href={wa} target="_blank" rel="noopener noreferrer">
        {t("Share on WhatsApp")}
      </a>
      <a className="btn btn-small" href={mail}>
        {t("Send by email")}
      </a>
    </div>
  );
}
