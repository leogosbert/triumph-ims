"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState, useTransition } from "react";
import { useTr } from "@/lib/tr-client";
import { decideQuotation } from "../actions";

/** Accept (with name, position and a typed or drawn signature) or decline a quotation. */
export function DecideQuote({ id, defaultName, defaultPosition }: { id: string; defaultName: string; defaultPosition: string }) {
  const tr = useTr();
  const router = useRouter();
  const [decision, setDecision] = useState<"accept" | "decline">("accept");
  const [kind, setKind] = useState<"typed" | "drawn">("typed");
  const [name, setName] = useState(defaultName);
  const [position, setPosition] = useState(defaultPosition);
  const [typed, setTyped] = useState("");
  const [reason, setReason] = useState("");
  const [poRef, setPoRef] = useState("");
  const [agree, setAgree] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const pad = useRef<PadHandle>(null);

  function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (decision === "accept") {
      if (!agree) return setError(tr("Tick the box to confirm you may accept for your organisation."));
      if (kind === "drawn" && pad.current?.isEmpty()) return setError(tr("Draw your signature in the box."));
    }
    const image = decision === "accept" && kind === "drawn" ? (pad.current?.toDataUrl() ?? "") : "";
    start(async () => {
      const r = await decideQuotation(id, {
        decision,
        name,
        position,
        signature_kind: decision === "accept" ? kind : null,
        signature_text: decision === "accept" && kind === "typed" ? typed : "",
        signature_image: image,
        reason,
        po_ref: decision === "accept" ? poRef : "",
      });
      if (r.error) setError(r.error);
      else {
        setDone(r.ok ?? "");
        router.refresh();
      }
    });
  }

  if (done) return <p className="notice notice-ok" role="status">{tr(done)}</p>;

  return (
    <form onSubmit={submit}>
      {error && <p className="notice notice-error" role="alert">{tr(error)}</p>}
      <div className="seg portal-seg" aria-label={tr("Your answer")}>
        <button type="button" aria-pressed={decision === "accept"} onClick={() => setDecision("accept")}>
          {tr("Accept")}
        </button>
        <button type="button" aria-pressed={decision === "decline"} onClick={() => setDecision("decline")}>
          {tr("Decline")}
        </button>
      </div>
      <fieldset className="plain" disabled={pending}>
        <div className="field">
          <label htmlFor="dq-name">{tr("Your full name")}</label>
          <input id="dq-name" type="text" required maxLength={120} autoComplete="name" value={name} onChange={(e) => setName(e.target.value)} />
        </div>
        {decision === "accept" && (
          <>
            <div className="field">
              <label htmlFor="dq-pos">{tr("Your position")}</label>
              <input id="dq-pos" type="text" required maxLength={120} autoComplete="organization-title" value={position} onChange={(e) => setPosition(e.target.value)} />
            </div>
            <div className="field">
              <label htmlFor="dq-po">
                {tr("Your order (LPO) number")} <span className="hint">{tr("optional")}</span>
              </label>
              <input id="dq-po" type="text" maxLength={120} value={poRef} onChange={(e) => setPoRef(e.target.value)} />
            </div>
            <div className="field">
              <span className="label-like">{tr("Signature")}</span>
              <div className="seg seg-sm portal-seg">
                <button type="button" aria-pressed={kind === "typed"} onClick={() => setKind("typed")}>
                  {tr("Type")}
                </button>
                <button type="button" aria-pressed={kind === "drawn"} onClick={() => setKind("drawn")}>
                  {tr("Draw")}
                </button>
              </div>
              {kind === "typed" ? (
                <>
                  <input
                    type="text"
                    aria-label={tr("Type your name as your signature")}
                    placeholder={tr("Type your name as your signature")}
                    maxLength={120}
                    value={typed}
                    onChange={(e) => setTyped(e.target.value)}
                  />
                  {typed && <p className="portal-typed-sig">{typed}</p>}
                </>
              ) : (
                <Pad ref={pad} clearLabel={tr("Clear")} label={tr("Draw your signature in the box.")} />
              )}
            </div>
          </>
        )}
        <div className="field">
          <label htmlFor="dq-reason">
            {decision === "accept" ? tr("Comment") : tr("Why are you declining?")} <span className="hint">{tr("optional")}</span>
          </label>
          <textarea id="dq-reason" maxLength={1000} value={reason} onChange={(e) => setReason(e.target.value)} />
        </div>
        {decision === "accept" && (
          <label className="check">
            <input type="checkbox" checked={agree} onChange={(e) => setAgree(e.target.checked)} />{" "}
            {tr("I accept this quotation and its terms on behalf of my organisation.")}
          </label>
        )}
        <button type="submit" className={`btn btn-block ${decision === "accept" ? "btn-primary" : "btn-danger"}`} style={{ marginTop: 12 }}>
          {pending ? tr("Sending…") : decision === "accept" ? tr("Accept quotation") : tr("Decline quotation")}
        </button>
      </fieldset>
    </form>
  );
}

type PadHandle = { isEmpty: () => boolean; toDataUrl: () => string };

function Pad({ ref, clearLabel, label }: { ref: React.Ref<PadHandle>; clearLabel: string; label: string }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const drawing = useRef(false);
  const last = useRef<{ x: number; y: number } | null>(null);
  const inked = useRef(false);

  const setup = useCallback(() => {
    const c = canvasRef.current;
    if (!c) return;
    // Kept at 1:1 so the saved picture stays small.
    c.width = c.clientWidth;
    c.height = c.clientHeight;
    const ctx = c.getContext("2d")!;
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, c.width, c.height);
    ctx.lineWidth = 2.2;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.strokeStyle = "#0b1f44";
    inked.current = false;
  }, []);

  useEffect(() => setup(), [setup]);

  useEffect(() => {
    const h: PadHandle = { isEmpty: () => !inked.current, toDataUrl: () => canvasRef.current?.toDataURL("image/png") ?? "" };
    if (typeof ref === "function") ref(h);
    else if (ref) (ref as React.RefObject<PadHandle | null>).current = h;
  }, [ref]);

  const point = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  };

  return (
    <div className="sig-wrap">
      <canvas
        ref={canvasRef}
        className="sig-pad"
        aria-label={label}
        role="img"
        onPointerDown={(e) => {
          e.currentTarget.setPointerCapture(e.pointerId);
          drawing.current = true;
          last.current = point(e);
          const ctx = e.currentTarget.getContext("2d")!;
          ctx.beginPath();
          ctx.arc(last.current.x, last.current.y, 1, 0, Math.PI * 2);
          ctx.fillStyle = "#0b1f44";
          ctx.fill();
          inked.current = true;
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
      <button type="button" className="btn btn-small sig-clear" onClick={setup}>
        {clearLabel}
      </button>
    </div>
  );
}
