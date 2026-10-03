export function Notice({ msg, error }: { msg?: string; error?: string }) {
  if (error) {
    return (
      <p className="notice notice-error" role="alert">
        {error}
      </p>
    );
  }
  if (msg) {
    return (
      <p className="notice notice-ok" role="status">
        {msg}
      </p>
    );
  }
  return null;
}
