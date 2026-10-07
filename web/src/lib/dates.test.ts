import { describe, expect, it } from 'vitest';
import {
  addDays,
  dayLabel,
  dayOfMonth,
  isValidDay,
  localDay,
  monthLabel,
  weekdayShort,
  weekDays,
  weekStart,
} from './dates';

describe('localDay', () => {
  it('gives the day in the given time zone, not the UTC one', () => {
    // 23:30 UTC on the 7th is already the 8th in Madrid (UTC+2).
    expect(localDay('2026-10-07T23:30:00Z', 'Europe/Madrid')).toBe('2026-10-08');
    expect(localDay('2026-10-07T23:30:00Z', 'America/New_York')).toBe('2026-10-07');
  });

  it('copes with the clock change in Madrid', () => {
    expect(localDay('2026-10-24T22:00:00Z', 'Europe/Madrid')).toBe('2026-10-25'); // 00:00 CEST
    expect(localDay('2026-10-25T22:30:00Z', 'Europe/Madrid')).toBe('2026-10-25'); // 23:30 CET
    expect(localDay('2026-10-25T23:00:00Z', 'Europe/Madrid')).toBe('2026-10-26');
  });

  it('accepts a Date', () => {
    expect(localDay(new Date('2026-10-07T12:00:00Z'), 'Europe/Madrid')).toBe('2026-10-07');
  });
});

describe('day arithmetic', () => {
  it('adds days across month and year ends', () => {
    expect(addDays('2026-10-31', 1)).toBe('2026-11-01');
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01');
    expect(addDays('2026-10-07', -7)).toBe('2026-09-30');
  });

  it('validates days', () => {
    expect(isValidDay('2026-10-07')).toBe(true);
    expect(isValidDay('2026-02-30')).toBe(false);
    expect(isValidDay('hoy')).toBe(false);
    expect(isValidDay(null)).toBe(false);
  });
});

describe('weeks start on Monday', () => {
  it('finds the Monday of any day of the week', () => {
    expect(weekStart('2026-10-07')).toBe('2026-10-05'); // Wednesday
    expect(weekStart('2026-10-05')).toBe('2026-10-05'); // Monday itself
    expect(weekStart('2026-10-11')).toBe('2026-10-05'); // Sunday belongs to the week before
    expect(weekStart('2026-10-12')).toBe('2026-10-12');
  });

  it('lists the seven days', () => {
    expect(weekDays('2026-10-05')).toEqual([
      '2026-10-05',
      '2026-10-06',
      '2026-10-07',
      '2026-10-08',
      '2026-10-09',
      '2026-10-10',
      '2026-10-11',
    ]);
  });
});

describe('labels in Spanish', () => {
  it('writes weekday, day, month and long day labels', () => {
    expect(weekdayShort('2026-10-07')).toBe('mié');
    expect(dayOfMonth('2026-10-07')).toBe('7');
    expect(dayOfMonth('2026-10-17')).toBe('17');
    expect(dayLabel('2026-10-07')).toBe('mié 7 oct');
    expect(monthLabel('2026-10-07')).toBe('Octubre 2026');
  });
});
