// A fixed, full-viewport background behind every page — an original,
// generic "football field under stadium lights" illustration, built as
// inline SVG rather than a photo. No real stadium, team, or copyrighted
// image is reproduced (same no-logos discipline as lib/team-colors.ts).
// Kept deliberately subtle (low opacity, heavily blurred) so it reads as
// mood/texture behind dense tables and text, never competes with them.
// Rendered once in the root layout so it covers login/signup too, not just
// the signed-in app shell.
export function BackgroundField() {
  return (
    <svg
      aria-hidden="true"
      className="fixed inset-0 -z-10 h-full w-full"
      preserveAspectRatio="xMidYMid slice"
      viewBox="0 0 1600 900"
    >
      <defs>
        <linearGradient id="bgfield-base" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#0a1510" />
          <stop offset="55%" stopColor="#09090b" />
          <stop offset="100%" stopColor="#050506" />
        </linearGradient>
        <radialGradient id="bgfield-light" cx="50%" cy="50%" r="50%">
          <stop offset="0%" stopColor="#fff7e0" stopOpacity="0.9" />
          <stop offset="100%" stopColor="#fff7e0" stopOpacity="0" />
        </radialGradient>
        <radialGradient id="bgfield-vignette" cx="50%" cy="50%" r="85%">
          <stop offset="0%" stopColor="#000000" stopOpacity="0" />
          <stop offset="100%" stopColor="#000000" stopOpacity="0.6" />
        </radialGradient>
        <filter id="bgfield-blur-soft" x="-50%" y="-50%" width="200%" height="200%">
          <feGaussianBlur stdDeviation="18" />
        </filter>
        <filter id="bgfield-blur-heavy" x="-50%" y="-50%" width="200%" height="200%">
          <feGaussianBlur stdDeviation="55" />
        </filter>
      </defs>

      <rect width="1600" height="900" fill="url(#bgfield-base)" />

      {/* Yard lines, in soft perspective */}
      <g stroke="#ffffff" strokeOpacity="0.24" filter="url(#bgfield-blur-soft)">
        <line x1="40" y1="120" x2="1560" y2="120" strokeWidth="2" />
        <line x1="10" y1="260" x2="1590" y2="260" strokeWidth="3" />
        <line x1="-40" y1="430" x2="1640" y2="430" strokeWidth="4" />
        <line x1="-120" y1="640" x2="1720" y2="640" strokeWidth="6" />
        <line x1="-240" y1="900" x2="1840" y2="900" strokeWidth="9" />
      </g>

      {/* Stadium floodlight glows */}
      <circle cx="220" cy="90" r="260" fill="url(#bgfield-light)" opacity="0.42" filter="url(#bgfield-blur-heavy)" />
      <circle cx="1380" cy="70" r="300" fill="url(#bgfield-light)" opacity="0.36" filter="url(#bgfield-blur-heavy)" />
      <circle cx="800" cy="-40" r="340" fill="url(#bgfield-light)" opacity="0.28" filter="url(#bgfield-blur-heavy)" />
      <circle cx="500" cy="500" r="380" fill="url(#bgfield-light)" opacity="0.12" filter="url(#bgfield-blur-heavy)" />
      <circle cx="1150" cy="620" r="400" fill="url(#bgfield-light)" opacity="0.1" filter="url(#bgfield-blur-heavy)" />

      {/* Vignette keeps the edges (and header/nav) dark and readable */}
      <rect width="1600" height="900" fill="url(#bgfield-vignette)" />
    </svg>
  );
}
