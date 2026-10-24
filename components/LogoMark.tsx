/**
 * The AUTISTIK mark: an endless loop (the infinity sign of the autism community) in spectrum colours, inside a
 * rounded tile with a soft glow and a small spark. Used at the top of the website and the App instead of the name.
 */
export default function LogoMark({ size = 40, title = "AUTISTIK" }: { size?: number; title?: string }) {
  return (
    <svg className="logo-mark" width={size} height={size} viewBox="0 0 64 64" role="img" aria-label={title}>
      <defs>
        <linearGradient id="lm-bg" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#2A1F45" />
          <stop offset="1" stopColor="#120C20" />
        </linearGradient>
        <linearGradient id="lm-ring" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#FFD84D" />
          <stop offset=".5" stopColor="#B57CFF" />
          <stop offset="1" stopColor="#4FD1FF" />
        </linearGradient>
        <linearGradient id="lm-loop" x1="0" y1="0" x2="1" y2="0">
          <stop offset="0" stopColor="#FF6B9A" />
          <stop offset=".28" stopColor="#FFD84D" />
          <stop offset=".55" stopColor="#5BE38F" />
          <stop offset=".78" stopColor="#4FD1FF" />
          <stop offset="1" stopColor="#B57CFF" />
        </linearGradient>
        <radialGradient id="lm-glow" cx=".5" cy=".55" r=".5">
          <stop offset="0" stopColor="#B57CFF" stopOpacity=".45" />
          <stop offset="1" stopColor="#B57CFF" stopOpacity="0" />
        </radialGradient>
      </defs>
      <rect x="2" y="2" width="60" height="60" rx="18" fill="url(#lm-bg)" />
      <rect x="2" y="2" width="60" height="60" rx="18" fill="none" stroke="url(#lm-ring)" strokeWidth="2.5" />
      <ellipse cx="32" cy="34" rx="24" ry="16" fill="url(#lm-glow)" />
      <path d="M20 23c-6 0-10 4.2-10 9s4 9 10 9c5.2 0 8.6-4 12-9 3.4-5 6.8-9 12-9 6 0 10 4.2 10 9s-4 9-10 9c-5.2 0-8.6-4-12-9-3.4-5-6.8-9-12-9z"
        fill="none" stroke="url(#lm-loop)" strokeWidth="5.2" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M48 9.5l1.3 3.2 3.2 1.3-3.2 1.3-1.3 3.2-1.3-3.2-3.2-1.3 3.2-1.3z" fill="#FFD84D" />
    </svg>
  );
}
