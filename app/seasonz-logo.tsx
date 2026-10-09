// Animated SEASONZ wordmark: fire-gradient letters that shimmer upward,
// with a small flickering flame mark. Pure CSS (see .szn-logo* in
// globals.css), so it costs nothing at runtime and stays still for anyone
// with reduced motion turned on.
export function SeasonzLogo({ size = "md" }: { size?: "md" | "lg" }) {
  return (
    <span className={`szn-logo inline-flex items-center gap-1.5 ${size === "lg" ? "text-2xl" : "text-base sm:text-lg"}`}>
      <svg viewBox="0 0 24 24" aria-hidden className={`szn-logo-flame ${size === "lg" ? "h-6 w-6" : "h-5 w-5"}`}>
        <defs>
          <linearGradient id="szn-logo-flame" x1="0" y1="1" x2="0" y2="0">
            <stop offset="0%" stopColor="#ff2a00" />
            <stop offset="55%" stopColor="#ff8a00" />
            <stop offset="100%" stopColor="#ffe08a" />
          </linearGradient>
        </defs>
        <path
          fill="url(#szn-logo-flame)"
          d="M12 2c1.2 3.1-.6 4.7-1.9 6.3C8.8 9.9 7.5 11.5 7.5 14a4.5 4.5 0 0 0 9 0c0-1.6-.7-2.9-1.4-3.9.1 1.4-.5 2.5-1.6 2.9.6-2.5-.3-4.6-1.5-6.4C11.4 5.6 12 3.9 12 2Z"
        />
      </svg>
      <span className="szn-logo-text font-black uppercase tracking-[0.12em]">Seasonz</span>
    </span>
  );
}
