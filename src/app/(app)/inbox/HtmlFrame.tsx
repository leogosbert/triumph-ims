/**
 * Shows an email's HTML safely: inside a sandboxed frame (no scripts, no access to the app) with a
 * Content-Security-Policy that blocks every network request, so remote images and tracking pixels
 * never load. Links open in a new tab. The HTML was also cleaned when it arrived (sanitize.ts).
 */
export function HtmlFrame({ html, title }: { html: string; title: string }) {
  const doc = `<!doctype html><html><head><meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src data:; style-src 'unsafe-inline'; font-src data:">
<base target="_blank"><style>body{font-family:Arial,sans-serif;font-size:14px;line-height:1.45;margin:8px;color:#15202e;background:#fff;overflow-wrap:anywhere}img{max-width:100%;height:auto}table{max-width:100%}</style>
</head><body>${html}</body></html>`;
  return (
    <iframe
      title={title}
      srcDoc={doc}
      sandbox="allow-popups allow-popups-to-escape-sandbox"
      referrerPolicy="no-referrer"
      loading="lazy"
      style={{ width: "100%", minHeight: 260, height: 420, border: "1px solid var(--line, #d0d7e2)", borderRadius: 8, background: "#fff" }}
    />
  );
}
