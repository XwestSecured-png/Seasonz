import type { MetadataRoute } from "next";

// Next.js serves this at /manifest.webmanifest and wires the <link
// rel="manifest"> tag automatically — this file is the whole PWA config.
// With this plus app/layout.tsx's appleWebApp metadata, "Add to Home
// Screen" (iOS) / "Install app" (Android/Chrome) launches full-screen in
// its own window instead of a browser tab with address-bar chrome.
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Seasonz",
    short_name: "Seasonz",
    description: "Seasonz — sports prediction model: schedules, Elo ratings, injury impact, props, and parlays.",
    start_url: "/",
    display: "standalone",
    background_color: "#09090b",
    theme_color: "#09090b",
    icons: [
      { src: "/icons/192", sizes: "192x192", type: "image/png" },
      { src: "/icons/512", sizes: "512x512", type: "image/png" },
      { src: "/icons/maskable", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}
