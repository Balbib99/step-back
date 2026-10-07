import { describe, expect, it } from 'vitest';
import { addDays, isRealDate, localDaysRangeUtc, seasonForDate, startOfDayUtc } from './dates.js';

const iso = (date: string, timeZone: string) => startOfDayUtc(date, timeZone).toISOString();

describe('startOfDayUtc', () => {
  it('finds midnight in Madrid in summer (UTC+2) and winter (UTC+1)', () => {
    expect(iso('2026-10-07', 'Europe/Madrid')).toBe('2026-10-06T22:00:00.000Z');
    expect(iso('2026-12-15', 'Europe/Madrid')).toBe('2026-12-14T23:00:00.000Z');
  });

  it('works in other zones, including UTC itself', () => {
    expect(iso('2026-10-06', 'America/New_York')).toBe('2026-10-06T04:00:00.000Z');
    expect(iso('2026-10-06', 'UTC')).toBe('2026-10-06T00:00:00.000Z');
  });

  it('starts the right instant on the days Madrid changes the clock', () => {
    // Clocks go back on 25 Oct 2026 (the day is 25 h long) and forward on 28 Mar 2027 (23 h).
    expect(iso('2026-10-25', 'Europe/Madrid')).toBe('2026-10-24T22:00:00.000Z');
    expect(iso('2026-10-26', 'Europe/Madrid')).toBe('2026-10-25T23:00:00.000Z');
    expect(iso('2027-03-28', 'Europe/Madrid')).toBe('2027-03-27T23:00:00.000Z');
    expect(iso('2027-03-29', 'Europe/Madrid')).toBe('2027-03-28T22:00:00.000Z');
  });
});

describe('localDaysRangeUtc', () => {
  const hours = (from: string, to: string) => {
    const range = localDaysRangeUtc(from, to, 'Europe/Madrid');
    return (Date.parse(range.toUtc) - Date.parse(range.fromUtc)) / 3_600_000;
  };

  it('covers whole local days, both ends inclusive', () => {
    expect(localDaysRangeUtc('2026-10-07', '2026-10-07', 'Europe/Madrid')).toEqual({
      fromUtc: '2026-10-06T22:00:00.000Z',
      toUtc: '2026-10-07T22:00:00.000Z',
    });
    expect(hours('2026-10-07', '2026-10-09')).toBe(72);
  });

  it('is 25 hours on the autumn change and 23 on the spring one', () => {
    expect(hours('2026-10-25', '2026-10-25')).toBe(25);
    expect(hours('2027-03-28', '2027-03-28')).toBe(23);
  });
});

describe('dates helpers', () => {
  it('adds days across month and year ends', () => {
    expect(addDays('2026-10-31', 1)).toBe('2026-11-01');
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01');
    expect(addDays('2026-03-01', -1)).toBe('2026-02-28');
  });

  it('accepts only real calendar dates written as YYYY-MM-DD', () => {
    expect(isRealDate('2026-10-07')).toBe(true);
    expect(isRealDate('2028-02-29')).toBe(true);
    expect(isRealDate('2026-02-30')).toBe(false);
    expect(isRealDate('2026-13-01')).toBe(false);
    expect(isRealDate('2026-10-7')).toBe(false);
    expect(isRealDate('hoy')).toBe(false);
  });
});

describe('seasonForDate', () => {
  it('names the season by the year it ends, switching in August', () => {
    expect(seasonForDate(new Date('2026-10-07T12:00:00Z'))).toBe(2027);
    expect(seasonForDate(new Date('2027-01-15T12:00:00Z'))).toBe(2027);
    expect(seasonForDate(new Date('2027-07-31T12:00:00Z'))).toBe(2027);
    expect(seasonForDate(new Date('2027-08-01T12:00:00Z'))).toBe(2028);
  });
});
