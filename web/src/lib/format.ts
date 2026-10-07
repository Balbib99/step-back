export const DEFAULT_TIME_ZONE = 'Europe/Madrid';

/** "23:41" in the given time zone. */
export function formatClock(iso: string, timeZone: string = DEFAULT_TIME_ZONE): string {
  return new Intl.DateTimeFormat('es-ES', {
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
    timeZone,
  }).format(new Date(iso));
}

/** "mié 7 oct" in the given time zone. */
export function formatDayLabel(date: Date, timeZone: string = DEFAULT_TIME_ZONE): string {
  const parts = new Intl.DateTimeFormat('es-ES', {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    timeZone,
  }).formatToParts(date);
  const part = (type: string) => parts.find((p) => p.type === type)?.value.replace('.', '') ?? '';
  return `${part('weekday')} ${part('day')} ${part('month')}`;
}
