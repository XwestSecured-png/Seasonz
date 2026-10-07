import { ImageResponse } from "next/og";

// Browser-tab favicon — generated at build/request time via next/og rather
// than a checked-in binary, so there's no image file to keep in sync with
// the app's own dark theme. Same no-logos discipline as lib/team-colors.ts:
// a generic football emoji, not any real team's mark.
export const size = { width: 32, height: 32 };
export const contentType = "image/png";

export default function Icon() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          background: "#09090b",
          fontSize: 22,
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
