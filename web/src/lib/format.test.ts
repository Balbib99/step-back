import { describe, expect, it } from 'vitest';
import { formatClock, formatDayLabel } from './format';

describe('formatClock', () => {
  it('converts to the given time zone using a 24-hour clock', () => {
    expect(formatClock('2026-10-07T21:41:00Z', 'Europe/Madrid')).toBe('23:41');
    expect(formatClock('2026-10-07T21:41:00Z', 'America/New_York')).toBe('17:41');
  });

  it('shows midnight as 00:xx, not 24:xx', () => {
    expect(formatClock('2026-10-07T22:05:00Z', 'Europe/Madrid')).toBe('00:05');
  });
});

describe('formatDayLabel', () => {
  it('writes weekday, day and month in Spanish', () => {
    expect(formatDayLabel(new Date('2026-10-07T12:00:00Z'), 'Europe/Madrid')).toBe('mié 7 oct');
  });

  it('uses the day of the given time zone, not the browser one', () => {
    // 23:30 UTC on the 7th is already the 8th in Madrid.
    expect(formatDayLabel(new Date('2026-10-07T23:30:00Z'), 'Europe/Madrid')).toBe('jue 8 oct');
  });
});
