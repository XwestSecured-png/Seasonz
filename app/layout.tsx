import type { Metadata, Viewport } from "next";
import "./globals.css";
import { BackgroundField } from "./background-field";

export const metadata: Metadata = {
  title: "Seasonz",
  description: "Seasonz — sports prediction model: schedules, Elo ratings, injury impact, props, and parlays.",
  // Together with app/manifest.ts, this is what makes "Add to Home Screen"
  // (iOS) launch the app full-screen in its own window — no Safari address
  // bar or tab chrome — rather than just bookmarking the page.
  appleWebApp: {
    capable: true,
    statusBarStyle: "black-translucent",
    title: "Seasonz",
  },
};

// viewport-fit=cover is what makes env(safe-area-inset-bottom) resolve to a
// real value instead of 0 on phones with a home-indicator bar, so the fixed
// bottom tab bar (see app/(app)/bottom-nav.tsx) doesn't sit under it.
// theme-color tints the mobile browser chrome to match the app, so it reads
// less like a web page and more like an installed app.
export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: "#09090b",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className="h-full antialiased">
      <body className="min-h-full flex flex-col font-sans bg-[#09090b]">
        <BackgroundField />
        {children}
      </body>
    </html>
  );
}
