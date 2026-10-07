/** Milliseconds `timeZone` is ahead of UTC at the given instant (DST aware). */
function offsetMs(instant: number, timeZone: string): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).formatToParts(new Date(instant));
  const part = (type: string) => Number(parts.find((p) => p.type === type)?.value);
  const wallClockAsUtc = Date.UTC(
    part('year'),
    part('month') - 1,
    part('day'),
    part('hour'),
    part('minute'),
    part('second'),
  );
  return wallClockAsUtc - Math.floor(instant / 1000) * 1000;
}

/** The UTC instant at which `date` (YYYY-MM-DD) begins in `timeZone`. */
export function startOfDayUtc(date: string, timeZone: string): Date {
  const [year, month, day] = date.split('-').map(Number) as [number, number, number];
  const guess = Date.UTC(year, month - 1, day);
  // Two passes so a day that starts right after a DST change still lands on the right instant.
  const first = guess - offsetMs(guess, timeZone);
  return new Date(guess - offsetMs(first, timeZone));
}

export function addDays(date: string, days: number): string {
  const [year, month, day] = date.split('-').map(Number) as [number, number, number];
  return new Date(Date.UTC(year, month - 1, day + days)).toISOString().slice(0, 10);
}

export function isRealDate(value: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(value) && addDays(value, 0) === value;
}

/** `[from, to)` in UTC covering the local days `fromDate`..`toDate`, both inclusive. */
export function localDaysRangeUtc(fromDate: string, toDate: string, timeZone: string) {
  return {
    fromUtc: startOfDayUtc(fromDate, timeZone).toISOString(),
    toUtc: startOfDayUtc(addDays(toDate, 1), timeZone).toISOString(),
  };
}

/**
 * ESPN names a season by the year it ends: 2026-27 is 2027. The new season is already
 * published in the summer, so from August on we are in the season that ends next year.
 */
export function seasonForDate(now: Date): number {
  return now.getUTCMonth() >= 7 ? now.getUTCFullYear() + 1 : now.getUTCFullYear();
}

/** The local day (YYYY-MM-DD) of an instant in `timeZone`. */
export function localDay(instant: Date, timeZone: string): string {
  // The en-CA locale writes dates as YYYY-MM-DD.
  return new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(instant);
}
