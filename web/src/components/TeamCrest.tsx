import { useState } from 'react';

/**
 * A team's crest on a white disc (docs/design.md: many crests vanish on their own colour).
 * Without a logo, or when it cannot load, the abbreviation takes its place.
 */
export function TeamCrest({
  abbr,
  logoUrl,
  size = 26,
}: {
  abbr: string;
  logoUrl: string | null | undefined;
  size?: number;
}) {
  const [failed, setFailed] = useState(false);
  const style = { width: size, height: size };

  if (!logoUrl || failed) {
    return (
      <span
        aria-hidden="true"
        style={style}
        className="grid shrink-0 place-items-center rounded-full bg-surface-2 text-[9px] font-bold tracking-tight text-text-2"
      >
        {abbr.slice(0, 3)}
      </span>
    );
  }
  return (
    <img
      src={logoUrl}
      alt=""
      loading="lazy"
      style={style}
      onError={() => setFailed(true)}
      className="shrink-0 rounded-full bg-white/95 object-contain p-[3px]"
    />
  );
}
