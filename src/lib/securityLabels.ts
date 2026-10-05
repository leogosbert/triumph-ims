/** Screen text for sign-in history entries (English keys; translated with tr()). */
export const EVENT_LABELS: Record<string, string> = {
  sign_in: "Signed in",
  sign_in_new_device: "Signed in on a new device",
  sign_out_everywhere: "Signed out on all other devices",
  password_changed: "Password changed",
  two_step_on: "Two-step verification turned on",
  two_step_off: "Two-step verification turned off",
  reauth: "Confirmed identity (password entered again)",
  export: "Downloaded company data",
};

export type SecurityEventRow = {
  id: string;
  user_id?: string;
  kind: string;
  device: string | null;
  ip_hint: string | null;
  created_at: string;
};
