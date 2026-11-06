// Seasonz background: the word SEASONZ outlined in fire over a dark
// backdrop with $100 bills drifting down. Original artwork built from SVG (gradients,
// turbulence and blur), no images. Fixed behind every page and kept low
// enough in opacity that tables and text stay readable on top.
//
// Performance: the SVG layers are drawn ONCE and never animated inside the
// SVG. All motion is CSS opacity/transform on plain HTML wrappers and
// spans, which phones run on the GPU. Animating SVG filters (turbulence,
// blur) every frame crashed iPhone Safari into a blank white page.
// Falling $100 bills (1.42.0; drawn like the current $100 in 1.42.2):
// pale blue-green paper, a Franklin-style engraved bust, the blue security
// ribbon, the copper inkwell and bell, seals and the gold 100. Drawn small,
// one-sided and far under real size, purely as decoration. One SVG, shared
// as a CSS background by every bill.
const BILL_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 236 100">
<defs>
<linearGradient id="p" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#eef1e6"/><stop offset=".45" stop-color="#e2e9dc"/><stop offset=".75" stop-color="#d9e4e2"/><stop offset="1" stop-color="#e8e6d4"/></linearGradient>
<pattern id="gl" width="6" height="6" patternUnits="userSpaceOnUse"><path d="M0 3Q1.5 0 3 3T6 3" fill="none" stroke="#9fb6a4" stroke-width=".35" opacity=".7"/></pattern>
<radialGradient id="face" cx=".5" cy=".4" r=".6"><stop offset="0" stop-color="#d8dccb"/><stop offset="1" stop-color="#a7b29c"/></radialGradient>
<linearGradient id="gold" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#e8c66a"/><stop offset=".5" stop-color="#c9963a"/><stop offset="1" stop-color="#a8762b"/></linearGradient>
<linearGradient id="cop" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#d79a63"/><stop offset="1" stop-color="#8a4a26"/></linearGradient>
<linearGradient id="rib" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#2f62b8"/><stop offset=".5" stop-color="#5d93e0"/><stop offset="1" stop-color="#2a56a6"/></linearGradient>
<linearGradient id="sh" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#fff" stop-opacity="0"/><stop offset=".5" stop-color="#fff" stop-opacity=".35"/><stop offset="1" stop-color="#fff" stop-opacity="0"/></linearGradient>
</defs>
<rect width="236" height="100" rx="2" fill="url(#p)"/>
<rect width="236" height="100" rx="2" fill="url(#gl)"/>
<rect x="4" y="4" width="228" height="92" fill="none" stroke="#5b7a66" stroke-width="1.6"/>
<rect x="7" y="7" width="222" height="86" fill="none" stroke="#7d9884" stroke-width=".6"/>
<text x="82" y="16" font-family="'Times New Roman',Georgia,serif" font-size="4.7" font-weight="700" letter-spacing=".15" text-anchor="middle" fill="#2b3a33">THE UNITED STATES OF AMERICA</text>
<text x="84" y="92" font-family="'Times New Roman',Georgia,serif" font-size="5" font-weight="700" letter-spacing=".4" text-anchor="middle" fill="#2b3a33">ONE HUNDRED DOLLARS</text>
<text x="40" y="25" font-family="'Times New Roman',serif" font-size="4" letter-spacing=".3" text-anchor="middle" fill="#3d4d45">FEDERAL RESERVE NOTE</text>
<g font-family="'Times New Roman',Georgia,serif" font-weight="700" fill="#2b3a33">
<text x="11" y="21" font-size="12">100</text>
<text x="226" y="21" font-size="10" text-anchor="end" fill="#5b6a3a">100</text>
<text x="11" y="90" font-size="10">100</text>
</g>
<g font-family="'Courier New',monospace" font-size="5.2" font-weight="700" fill="#3d6b4a"><text x="20" y="34">LB 26114309 B</text><text x="166" y="80">LB 26114309 B</text></g>
<circle cx="40" cy="55" r="11" fill="none" stroke="#2b3a33" stroke-width="1.4"/>
<circle cx="40" cy="55" r="8" fill="none" stroke="#2b3a33" stroke-width=".5" stroke-dasharray="1 .7"/>
<text x="40" y="58.5" font-family="'Times New Roman',serif" font-size="10" font-weight="700" text-anchor="middle" fill="#2b3a33">B</text>
<ellipse cx="92" cy="54" rx="25" ry="31" fill="url(#face)" opacity=".85"/>
<path d="M66 86 C68 72 78 67 92 66 C106 67 116 72 118 86 Z" fill="#3a4a40"/>
<path d="M85 67 L92 78 L99 67 C97 70 87 70 85 67 Z" fill="#e9ead9"/>
<path d="M78 46 C76 58 80 66 86 69 L98 69 C104 66 108 58 106 46 C106 37 100 30 92 30 C84 30 78 37 78 46 Z" fill="#c9cbb6"/>
<path d="M77 47 C74 58 76 68 83 72 C80 64 80 55 82 47 Z M107 47 C110 58 108 68 101 72 C104 64 104 55 102 47 Z" fill="#6d7466"/>
<path d="M79 44 C80 36 85 31 92 31 C99 31 104 36 105 44 C102 39 98 37 92 37 C86 37 82 39 79 44 Z" fill="#8f9584" opacity=".8"/>
<g fill="none" stroke="#4a5246" stroke-width=".9" stroke-linecap="round">
<path d="M85 49 Q87.5 47.6 90 49"/><path d="M94 49 Q96.5 47.6 99 49"/>
<path d="M92 50 L91 57 Q92 58.5 93.5 57.5"/><path d="M88.5 62.5 L95.5 62.5"/><path d="M86 59 Q85 61 86.5 63" stroke-width=".5"/><path d="M98 59 Q99 61 97.5 63" stroke-width=".5"/>
</g>
<path d="M82 54 C82 62 86 67 92 67 C98 67 102 62 102 54" fill="none" stroke="#7a8070" stroke-width=".6"/>
<g stroke="#2e3b33" stroke-width=".35" opacity=".35"><path d="M70 76 L84 70 M72 80 L86 73 M75 84 L88 76 M110 76 L100 70 M112 80 L98 73 M109 84 L96 76"/><path d="M79 52 L83 50 M79 56 L83 54 M80 60 L84 58 M105 52 L101 50 M105 56 L101 54 M104 60 L100 58"/></g>
<rect x="124" y="0" width="7" height="100" fill="url(#rib)"/>
<g fill="#cfe0ff" opacity=".9"><text x="127.5" y="20" font-size="5" font-weight="700" text-anchor="middle" font-family="Arial,sans-serif">100</text><path d="M126 34 l1.5 -2.5 l1.5 2.5 z"/><text x="127.5" y="50" font-size="5" font-weight="700" text-anchor="middle" font-family="Arial,sans-serif">100</text><path d="M126 64 l1.5 -2.5 l1.5 2.5 z"/><text x="127.5" y="80" font-size="5" font-weight="700" text-anchor="middle" font-family="Arial,sans-serif">100</text></g>
<path d="M140 62 L162 62 L159 76 L143 76 Z" fill="url(#cop)" opacity=".9"/>
<path d="M146 60 C146 48 156 48 156 60 L158 64 L144 64 Z" fill="#c07a44" opacity=".95"/>
<rect x="150" y="45" width="2" height="4" fill="#8a4a26"/>
<path d="M143 64 L159 64" stroke="#6e3a1d" stroke-width="1"/>
<path d="M162 30 C168 38 166 52 158 60" fill="none" stroke="#7c8a7d" stroke-width="1.2"/>
<circle cx="180" cy="46" r="9" fill="none" stroke="#3a7a4a" stroke-width="1.2"/>
<circle cx="180" cy="46" r="7" fill="none" stroke="#3a7a4a" stroke-width=".4" stroke-dasharray=".8 .6"/>
<path d="M176 42 L184 42 L184 47 Q184 51 180 52.5 Q176 51 176 47 Z" fill="none" stroke="#3a7a4a" stroke-width=".9"/>
<path d="M176 45 L184 45" stroke="#3a7a4a" stroke-width=".7"/>
<text x="224" y="73" font-family="'Times New Roman',Georgia,serif" font-size="27" font-weight="700" text-anchor="end" fill="url(#gold)" stroke="#8a6326" stroke-width=".5">100</text>
<ellipse cx="206" cy="38" rx="11" ry="14" fill="#fff" opacity=".18"/>
<text x="206" y="86" font-family="'Times New Roman',serif" font-size="5.5" font-weight="700" letter-spacing=".5" text-anchor="middle" fill="#3d4d45">USA 100</text>
<rect x="50" y="0" width="40" height="100" fill="url(#sh)" transform="skewX(-20)"/>
</svg>`;
const BILL_URL = `url("data:image/svg+xml,${encodeURIComponent(BILL_SVG)}")`;

const BILLS = [
  { x: 120, d: 13, delay: 0, w: 76 },
  { x: 300, d: 16, delay: 4, w: 68 },
  { x: 470, d: 14, delay: 8, w: 82 },
  { x: 650, d: 17, delay: 2, w: 70 },
  { x: 820, d: 15, delay: 6, w: 78 },
  { x: 990, d: 13.5, delay: 10, w: 66 },
  { x: 1150, d: 16.5, delay: 3, w: 80 },
  { x: 1320, d: 14.5, delay: 7, w: 72 },
  { x: 1480, d: 18, delay: 1, w: 76 },
  { x: 230, d: 15.5, delay: 11, w: 64 },
  { x: 740, d: 12.5, delay: 5, w: 74 },
  { x: 1240, d: 17.5, delay: 9, w: 68 },
];

// Cash drop (1.42.2): every 40 seconds a burst of bills showers down
// together for a few seconds, then the regular drift carries on.
const DROP = Array.from({ length: 18 }, (_, i) => ({
  left: 3 + ((i * 37) % 94),
  w: 56 + ((i * 13) % 34),
  delay: 15 + ((i * 7) % 10) * 0.18,
  alt: i % 2 === 1,
}));

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
            height: Math.round(b.w * 0.424),
            backgroundImage: BILL_URL,
            animationDuration: `${b.d}s`,
            animationDelay: `${b.delay}s`,
          }}
        />
      ))}
      {DROP.map((b, i) => (
        <span
          key={`drop-${i}`}
          className={`szn-bill szn-drop ${b.alt ? "szn-drop-b" : ""}`}
          style={{
            left: `${b.left}%`,
            width: b.w,
            height: Math.round(b.w * 0.424),
            backgroundImage: BILL_URL,
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
