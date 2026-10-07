import { formatDayLabel } from './format';

// Days are plain 'YYYY-MM-DD' strings in the configured time zone (Europe/Madrid), the same local
// days the server uses for /api/games?date=. Calendar arithmetic is done in UTC on those strings,
// so it is never affected by the browser's own time zone or by daylight saving.

const DAY_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

export function addDays(day: string, days: number): string {
  const [year, month, date] = day.split('-').map(Number) as [number, number, number];
  return new Date(Date.UTC(year, month - 1, date + days)).toISOString().slice(0, 10);
}

export function isValidDay(value: string | null | undefined): value is string {
  return value != null && DAY_PATTERN.test(value) && addDays(value, 0) === value;
}

/** The local day (in `timeZone`) of an instant. */
export function localDay(iso: string | Date, timeZone: string): string {
  const date = typeof iso === 'string' ? new Date(iso) : iso;
  // The en-CA locale writes dates as YYYY-MM-DD.
  return new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(date);
}

/** Monday of the week containing `day`. */
export function weekStart(day: string): string {
  const [year, month, date] = day.split('-').map(Number) as [number, number, number];
  const weekday = new Date(Date.UTC(year, month - 1, date)).getUTCDay(); // 0 = Sunday
  return addDays(day, -((weekday + 6) % 7));
}

export function weekDays(start: string): string[] {
  return Array.from({ length: 7 }, (_, index) => addDays(start, index));
}

const noon = (day: string) => new Date(`${day}T12:00:00Z`);

/** "mié" */
export function weekdayShort(day: string): string {
  return new Intl.DateTimeFormat('es-ES', { weekday: 'short', timeZone: 'UTC' })
    .format(noon(day))
    .replace('.', '');
}

/** "7" */
export function dayOfMonth(day: string): string {
  return String(Number(day.slice(8)));
}

/** "mié 7 oct" */
export function dayLabel(day: string): string {
  return formatDayLabel(noon(day), 'UTC');
}

/** "Octubre 2026" */
export function monthLabel(day: string): string {
  const parts = new Intl.DateTimeFormat('es-ES', {
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  }).formatToParts(noon(day));
  const part = (type: string) => parts.find((p) => p.type === type)?.value ?? '';
  const month = part('month');
  return `${month.charAt(0).toUpperCase()}${month.slice(1)} ${part('year')}`;
}
