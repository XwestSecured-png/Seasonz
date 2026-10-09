"use client";

// Last-resort screen if the root layout itself crashes, so the app never
// shows a blank white page. Inline styles because global CSS isn't loaded here.
export default function GlobalError({
  error,
  retry,
}: {
  error: Error & { digest?: string };
  retry: () => void;
}) {
  return (
    <html lang="en">
      <body style={{ margin: 0, minHeight: "100vh", background: "#09090b", color: "#e5e5e5", fontFamily: "system-ui, sans-serif" }}>
        <title>Seasonz</title>
        <div style={{ maxWidth: 420, margin: "0 auto", padding: "80px 20px", textAlign: "center" }}>
          <h1 style={{ fontSize: 20, color: "#ffb347" }}>Seasonz hit a snag</h1>
          <p style={{ fontSize: 14, color: "#a3a3a3" }}>Tap Reload. If it keeps happening, screenshot this and send it to an admin.</p>
          <p style={{ fontSize: 12, color: "#737373", wordBreak: "break-word" }}>
            {error.message}
            {error.digest ? ` (${error.digest})` : ""}
          </p>
          <div style={{ display: "flex", gap: 8, justifyContent: "center", marginTop: 16 }}>
            <button
              onClick={() => retry()}
              style={{ background: "#2563eb", color: "#fff", border: 0, borderRadius: 6, padding: "8px 14px", fontSize: 14 }}
            >
              Try again
            </button>
            <button
              onClick={() => window.location.reload()}
              style={{ background: "#262626", color: "#fff", border: 0, borderRadius: 6, padding: "8px 14px", fontSize: 14 }}
            >
              Reload
            </button>
          </div>
        </div>
      </body>
    </html>
  );
}
