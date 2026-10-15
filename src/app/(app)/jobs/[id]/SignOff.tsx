"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { useTr } from "@/lib/tr-client";
import { completeJob } from "../actions";

/**
 * Finish a job: findings, the client's name and signature on the phone. The signature goes to the
 * private "pod" bucket under <company>/jobs/<job>/ before the form is sent.
 */
export function SignOff({ jobId, companyId, findings }: { jobId: string; companyId: string; findings: string }) {
  const t = useTr();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const drawing = useRef(false);
  const last = useRef<{ x: number; y: number } | null>(null);
  const [inked, setInked] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const pathRef = useRef<HTMLInputElement>(null);
  const formRef = useRef<HTMLFormElement>(null);

  const setup = useCallback(() => {
    const c = canvasRef.current;
    if (!c) return;
    const ratio = Math.max(window.devicePixelRatio || 1, 1);
    c.width = Math.round(c.clientWidth * ratio);
    c.height = Math.round(c.clientHeight * ratio);
    const ctx = c.getContext("2d")!;
    ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, c.clientWidth, c.clientHeight);
    ctx.lineWidth = 2.2;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.strokeStyle = "#0b1f44";
    setInked(false);
  }, []);

  useEffect(() => {
    setup();
  }, [setup]);

  const point = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  };

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    if (pathRef.current?.value || !inked) return; // signature already uploaded, or none: send the form as it is
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      const blob = await new Promise<Blob | null>((resolve) => canvasRef.current?.toBlob((b) => resolve(b), "image/png"));
      if (!blob) throw new Error("no signature");
      const path = `${companyId}/jobs/${jobId}/signature-${Date.now()}.png`;
      const { error: upErr } = await createClient().storage.from("pod").upload(path, blob, { contentType: "image/png" });
      if (upErr) throw upErr;
      if (pathRef.current) pathRef.current.value = path;
      formRef.current?.requestSubmit();
    } catch {
      setBusy(false);
      setError(t("The signature could not be saved. Check the connection and try again, or finish without it."));
    }
  }

  return (
    <form ref={formRef} action={completeJob} onSubmit={onSubmit}>
      <input type="hidden" name="id" value={jobId} />
      <input ref={pathRef} type="hidden" name="signature_path" defaultValue="" />
      <div className="field">
        <label htmlFor="sign-findings">{t("Findings and work done")}</label>
        <textarea id="sign-findings" name="findings" maxLength={4000} defaultValue={findings} placeholder={t("e.g. Replaced the seal, pressure tested at 6 bar, no leaks")} />
      </div>
      <div className="field">
        <label htmlFor="signed_by">{t("Client's name")}</label>
        <input id="signed_by" name="signed_by" type="text" maxLength={120} placeholder={t("Who accepted the work")} />
      </div>
      <div className="field">
        <label>{t("Client's signature")}</label>
        <div className="sj-sig">
          <canvas
            ref={canvasRef}
            onPointerDown={(e) => {
              e.currentTarget.setPointerCapture(e.pointerId);
              drawing.current = true;
              last.current = point(e);
              const ctx = e.currentTarget.getContext("2d")!;
              ctx.beginPath();
              ctx.arc(last.current.x, last.current.y, 1, 0, Math.PI * 2);
              ctx.fillStyle = "#0b1f44";
              ctx.fill();
              setInked(true);
            }}
            onPointerMove={(e) => {
              if (!drawing.current || !last.current) return;
              const p = point(e);
              const ctx = e.currentTarget.getContext("2d")!;
              ctx.beginPath();
              ctx.moveTo(last.current.x, last.current.y);
              ctx.lineTo(p.x, p.y);
              ctx.stroke();
              last.current = p;
            }}
            onPointerUp={() => {
              drawing.current = false;
              last.current = null;
            }}
            onPointerCancel={() => {
              drawing.current = false;
              last.current = null;
            }}
          />
          <button type="button" className="btn btn-small" onClick={setup}>
            {t("Clear")}
          </button>
        </div>
        <span className="hint small muted">{t("Optional, but it settles any argument about whether the work was done.")}</span>
      </div>
      {error && <p className="notice notice-error small">{error}</p>}
      <button type="submit" className="btn btn-primary btn-block" disabled={busy} aria-busy={busy}>
        {busy ? t("Saving…") : t("Complete the job")}
      </button>
      <p className="muted small" style={{ marginTop: 6 }}>
        {t("Materials on the job leave the store now (oldest batches first) and finance is told the job is ready to invoice.")}
      </p>
    </form>
  );
}
