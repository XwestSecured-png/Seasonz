import { ImageResponse } from "next/og";

// Apple touch icon — Next auto-wires the <link rel="apple-touch-icon"> tag
// for this file. This is what shows on an iOS home screen after "Add to
// Home Screen", so it's drawn with rounded corners baked in (iOS also
// applies its own mask, but this keeps it looking right everywhere else
// the browser might surface it too).
export const size = { width: 180, height: 180 };
export const contentType = "image/png";

export default function AppleIcon() {
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
          fontSize: 108,
          color: "#22c55e",
          fontWeight: 800,
          fontFamily: "sans-serif",
        }}
      >
        S
      </div>
    ),
    { ...size }
  );
}
