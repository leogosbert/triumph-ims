"use client";

import { useFormStatus } from "react-dom";

/** A form button that shows it is working and can't be pressed twice. */
export function SubmitButton({
  children,
  pendingText = "Saving…",
  className = "btn btn-primary",
  name,
  value,
}: {
  children: React.ReactNode;
  pendingText?: string;
  className?: string;
  name?: string;
  value?: string;
}) {
  const { pending } = useFormStatus();
  return (
    <button type="submit" className={className} disabled={pending} aria-busy={pending} name={name} value={value}>
      {pending ? pendingText : children}
    </button>
  );
}
