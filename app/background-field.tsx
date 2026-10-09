// Seasonz background: the word SEASONZ outlined in fire over a dark,
// ember-lit backdrop. Original artwork built from SVG (gradients,
// turbulence and blur), no images. Fixed behind every page and kept low
// enough in opacity that tables and text stay readable on top.
const EMBERS = [
  { x: 180, d: 9, delay: 0, r: 2.2 },
  { x: 340, d: 12, delay: 3, r: 1.6 },
  { x: 520, d: 10, delay: 6, r: 2.4 },
  { x: 690, d: 13, delay: 1.5, r: 1.8 },
  { x: 860, d: 11, delay: 4.5, r: 2.6 },
  { x: 1020, d: 9.5, delay: 7, r: 1.7 },
  { x: 1190, d: 12.5, delay: 2, r: 2.1 },
  { x: 1360, d: 10.5, delay: 5.5, r: 1.9 },
  { x: 1480, d: 14, delay: 8, r: 1.5 },
  { x: 260, d: 11, delay: 9, r: 1.4 },
  { x: 610, d: 8.5, delay: 2.5, r: 2 },
  { x: 940, d: 12, delay: 10, r: 1.6 },
  { x: 1280, d: 9, delay: 6.5, r: 2.3 },
  { x: 1560, d: 10, delay: 3.5, r: 1.8 },
  { x: 90, d: 13.5, delay: 5, r: 2 },
];

export function BackgroundField() {
  return (
    <>
    <svg
      aria-hidden="true"
      className="fixed inset-0 -z-10 h-full w-full"
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
        <filter id="szn-ember-blur">
          <feGaussianBlur stdDeviation="1.2" />
        </filter>
      </defs>

      <rect width="1600" height="900" fill="url(#szn-base)" />
      <rect width="1600" height="900" fill="url(#szn-heat)" className="szn-heat-pulse" />

      {/* Rising embers */}
      <g filter="url(#szn-ember-blur)">
        {EMBERS.map((e) => (
          <circle
            key={e.x}
            cx={e.x}
            cy={860}
            r={e.r}
            fill="#ffb347"
            className="szn-ember"
            style={{ animationDuration: `${e.d}s`, animationDelay: `${e.delay}s` }}
          />
        ))}
      </g>

      {/* Keeps edges, header and nav dark so content stays readable */}
      <rect width="1600" height="900" fill="url(#szn-vignette)" />
    </svg>

    {/* The word gets its own layer that always fits the screen width, so
        the whole of SEASONZ shows on a phone as well as a monitor. */}
    <svg
      aria-hidden="true"
      className="pointer-events-none fixed left-0 right-0 top-[17%] sm:top-[38%] -z-10 mx-auto w-full max-w-[1600px] -translate-y-1/2 px-2"
      viewBox="0 250 1600 360"
      preserveAspectRatio="xMidYMid meet"
    >
      <defs>
        <linearGradient id="szn-flame" x1="0" y1="1" x2="0" y2="0" spreadMethod="reflect">
          <animate attributeName="y1" values="1;0.4;1" dur="3.5s" repeatCount="indefinite" />
          <animate attributeName="y2" values="0;-0.6;0" dur="3.5s" repeatCount="indefinite" />
          <stop offset="0%" stopColor="#ff2a00" />
          <stop offset="40%" stopColor="#ff7a00" />
          <stop offset="75%" stopColor="#ffc400" />
          <stop offset="100%" stopColor="#fff3b0" />
        </linearGradient>
        <filter id="szn-burn" x="-10%" y="-40%" width="120%" height="180%">
          <feTurbulence type="fractalNoise" baseFrequency="0.012 0.045" numOctaves="2" seed="7" result="noise">
            <animate attributeName="baseFrequency" values="0.012 0.045;0.014 0.06;0.012 0.045" dur="2.4s" repeatCount="indefinite" />
          </feTurbulence>
          <feDisplacementMap in="SourceGraphic" in2="noise" scale="14" xChannelSelector="R" yChannelSelector="G" />
        </filter>
        <filter id="szn-glow-blur" x="-20%" y="-60%" width="140%" height="220%">
          <feGaussianBlur stdDeviation="16" />
        </filter>
      </defs>
      <g fontFamily="'Arial Black', 'Helvetica Neue', Impact, system-ui, sans-serif" fontWeight="900" fontSize="250" textAnchor="middle" letterSpacing="6">
        {/* Soft heat glow behind the letters */}
        <text x="800" y="520" fill="none" stroke="#ff5a00" strokeWidth="22" opacity="0.6" filter="url(#szn-glow-blur)" className="szn-fire-glow">
          SEASONZ
        </text>
        {/* The fire outline itself */}
        <g filter="url(#szn-burn)" className="szn-fire-flicker">
          <text x="800" y="520" fill="none" stroke="url(#szn-flame)" strokeWidth="7" strokeLinejoin="round" opacity="0.85">
            SEASONZ
          </text>
          <text x="800" y="520" fill="none" stroke="#fff1c2" strokeWidth="1.5" opacity="0.55">
            SEASONZ
          </text>
        </g>
      </g>

    </svg>
    </>
  );
}
