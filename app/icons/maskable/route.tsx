import { ImageResponse } from "next/og";

// "Maskable" per the PWA manifest spec — Android can crop this to a circle,
// squircle, or rounded square depending on the device, so the glyph is kept
// well inside the safe zone (roughly the inner 80% diameter) and the
// background fills edge-to-edge rather than leaving transparent corners.
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
          fontSize: 200,
          color: "#22c55e",
          fontWeight: 800,
          fontFamily: "sans-serif",
        }}
      >
        S
      </div>
    ),
    { width: 512, height: 512 }
  );
}
