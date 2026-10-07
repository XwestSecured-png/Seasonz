import { ImageResponse } from "next/og";

// A stable, fixed URL (unlike app/icon.tsx's auto-hashed route) so
// app/manifest.ts can reference it directly — the PWA manifest spec needs a
// real src path, not Next's per-build favicon convention.
export async function GET() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          background: "linear-gradient(135deg, #0a1510 0%, #09090b 60%, #050506 100%)",
          fontSize: 120,
          color: "#22c55e",
          fontWeight: 800,
          fontFamily: "sans-serif",
        }}
      >
        S
      </div>
    ),
    { width: 192, height: 192 }
  );
}
