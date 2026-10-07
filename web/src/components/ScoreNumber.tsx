import { useEffect, useState } from 'react';

/** A bit longer than the 200 ms of the CSS animation. */
const TICK_MS = 300;

/**
 * A score. When the value changes after the first render (a live game scoring), it ticks once:
 * a short drop-in that tells the eye something moved. Reduced motion turns the animation off in
 * the CSS; the class is cleared on a timer rather than on `animationend`, which would never come
 * in that case.
 */
export function ScoreNumber({
  value,
  className = '',
}: {
  value: number | null;
  className?: string;
}) {
  const [previous, setPrevious] = useState(value);
  const [ticking, setTicking] = useState(false);
  if (value !== previous) {
    setPrevious(value);
    setTicking(true);
  }

  useEffect(() => {
    if (!ticking) return;
    const timer = setTimeout(() => setTicking(false), TICK_MS);
    return () => clearTimeout(timer);
  }, [ticking, value]);

  // `key` restarts the animation each time the value changes.
  return (
    <span
      key={value ?? 'none'}
      aria-label={`${value ?? 0} puntos`}
      className={`${className} ${ticking ? 'score-tick' : ''}`}
    >
      {value}
    </span>
  );
}
