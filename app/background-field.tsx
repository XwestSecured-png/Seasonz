// Seasonz background: the word SEASONZ outlined in fire over a dark
// backdrop with $100 bills drifting down. Original artwork built from SVG (gradients,
// turbulence and blur), no images. Fixed behind every page and kept low
// enough in opacity that tables and text stay readable on top.
//
// Performance: the SVG layers are drawn ONCE and never animated inside the
// SVG. All motion is CSS opacity/transform on plain HTML wrappers and
// spans, which phones run on the GPU. Animating SVG filters (turbulence,
// blur) every frame crashed iPhone Safari into a blank white page.
// Falling $100 bills (1.42.0, replaced the rising fire sparks). Each bill
// is one original SVG drawing (no portrait, no real-currency text), set as a
// CSS background so all of them share a single image.
const BILL_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 120 52">
<defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#e3f0d9"/><stop offset=".5" stop-color="#c4dcb5"/><stop offset="1" stop-color="#a9c99a"/></linearGradient>
<linearGradient id="s" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#fff" stop-opacity="0"/><stop offset=".5" stop-color="#fff" stop-opacity=".45"/><stop offset="1" stop-color="#fff" stop-opacity="0"/></linearGradient></defs>
<rect x=".75" y=".75" width="118.5" height="50.5" rx="3" fill="url(#g)" stroke="#2f5a29" stroke-width="1.5"/>
<rect x="5" y="5" width="110" height="42" rx="2" fill="none" stroke="#3f7436" stroke-width="1.1" stroke-dasharray="2.5 1.5"/>
<ellipse cx="60" cy="26" rx="15" ry="17" fill="#b7d4a8" stroke="#2f5a29" stroke-width="1.2"/>
<text x="60" y="32.5" font-family="Georgia,serif" font-size="19" font-weight="700" text-anchor="middle" fill="#1f441b">$</text>
<g font-family="Georgia,serif" font-weight="700" fill="#1f441b"><text x="10" y="18" font-size="11">100</text><text x="110" y="44" font-size="11" text-anchor="end">100</text><text x="110" y="18" font-size="7" text-anchor="end">100</text><text x="10" y="44" font-size="7">100</text></g>
<rect x="38" y="0" width="26" height="52" fill="url(#s)" transform="skewX(-20)"/>
</svg>`;
const BILL_URL = `url("data:image/svg+xml,${encodeURIComponent(BILL_SVG)}")`;

const BILLS = [
  { x: 120, d: 13, delay: 0, w: 62 },
  { x: 300, d: 16, delay: 4, w: 54 },
  { x: 470, d: 14, delay: 8, w: 68 },
  { x: 650, d: 17, delay: 2, w: 56 },
  { x: 820, d: 15, delay: 6, w: 64 },
  { x: 990, d: 13.5, delay: 10, w: 52 },
  { x: 1150, d: 16.5, delay: 3, w: 66 },
  { x: 1320, d: 14.5, delay: 7, w: 58 },
  { x: 1480, d: 18, delay: 1, w: 62 },
  { x: 230, d: 15.5, delay: 11, w: 50 },
  { x: 740, d: 12.5, delay: 5, w: 60 },
  { x: 1240, d: 17.5, delay: 9, w: 54 },
];

export function BackgroundField() {
  return (
    <>
    <svg
      aria-hidden="true"
      className="fixed inset-0 -z-20 h-full w-full"
      preserveAspectRatio="xMidYMid slice"
      viewBox="0 0 1600 900"
    >
      <defs>
        <linearGradient id="szn-base" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#09090b" />
          <stop offset="60%" stopColor="#0d0805" />
          <stop offset="100%" stopColor="#1a0a03" />
        </linearGradient>
        <radialGradient id="szn-heat" cx="50%" cy="100%" r="70%">
          <stop offset="0%" stopColor="#ff6a00" stopOpacity="0.35" />
          <stop offset="55%" stopColor="#b52a00" stopOpacity="0.08" />
          <stop offset="100%" stopColor="#000" stopOpacity="0" />
        </radialGradient>
        
        <radialGradient id="szn-vignette" cx="50%" cy="45%" r="80%">
          <stop offset="0%" stopColor="#000" stopOpacity="0" />
          <stop offset="100%" stopColor="#000" stopOpacity="0.75" />
        </radialGradient>
      </defs>

      <rect width="1600" height="900" fill="url(#szn-base)" />
      <rect width="1600" height="900" fill="url(#szn-heat)" />

      {/* Keeps edges, header and nav dark so content stays readable */}
      <rect width="1600" height="900" fill="url(#szn-vignette)" />
    </svg>

    {/* Heat glow + falling bills: HTML layers so the animation stays on the GPU. */}
    <div aria-hidden="true" className="szn-heat-pulse pointer-events-none fixed inset-0 -z-20" />
    <div aria-hidden="true" className="pointer-events-none fixed inset-0 -z-10 overflow-hidden">
      {BILLS.map((b, i) => (
        <span
          key={b.x}
          className={`szn-bill ${i % 2 ? "szn-bill-b" : ""}`}
          style={{
            left: `${(b.x / 1600) * 100}%`,
            width: b.w,
            height: Math.round(b.w * 0.433),
            backgroundImage: BILL_URL,
            animationDuration: `${b.d}s`,
            animationDelay: `${b.delay}s`,
          }}
        />
      ))}
    </div>

    {/* The word gets its own layer that always fits the screen width, so
        the whole of SEASONZ shows on a phone as well as a monitor. */}
    <div aria-hidden="true" className="szn-fire-flicker pointer-events-none fixed left-0 right-0 top-[17%] sm:top-[38%] -z-10 mx-auto w-full max-w-[1600px] -translate-y-1/2 px-2">
    <svg
      className="block w-full h-auto"
      viewBox="0 250 1600 360"
      preserveAspectRatio="xMidYMid meet"
    >
      <defs>
        <linearGradient id="szn-flame" x1="0" y1="1" x2="0" y2="0" spreadMethod="reflect">
          <stop offset="0%" stopColor="#ff2a00" />
          <stop offset="40%" stopColor="#ff7a00" />
          <stop offset="75%" stopColor="#ffc400" />
          <stop offset="100%" stopColor="#fff3b0" />
        </linearGradient>
        <filter id="szn-burn" x="-10%" y="-40%" width="120%" height="180%">
          <feTurbulence type="fractalNoise" baseFrequency="0.012 0.045" numOctaves="2" seed="7" result="noise" />
          <feDisplacementMap in="SourceGraphic" in2="noise" scale="14" xChannelSelector="R" yChannelSelector="G" />
        </filter>
        <filter id="szn-glow-blur" x="-20%" y="-60%" width="140%" height="220%">
          <feGaussianBlur stdDeviation="16" />
        </filter>
      </defs>
      <g fontFamily="'Arial Black', 'Helvetica Neue', Impact, system-ui, sans-serif" fontWeight="900" fontSize="250" textAnchor="middle" letterSpacing="6">
        {/* Soft heat glow behind the letters */}
        <text x="800" y="520" fill="none" stroke="#ff5a00" strokeWidth="22" opacity="0.6" filter="url(#szn-glow-blur)">
          SEASONZ
        </text>
        {/* The fire outline itself */}
        <g filter="url(#szn-burn)">
          <text x="800" y="520" fill="none" stroke="url(#szn-flame)" strokeWidth="7" strokeLinejoin="round" opacity="0.85">
            SEASONZ
          </text>
          <text x="800" y="520" fill="none" stroke="#fff1c2" strokeWidth="1.5" opacity="0.55">
            SEASONZ
          </text>
        </g>
      </g>

    </svg>
    </div>
    </>
  );
}
