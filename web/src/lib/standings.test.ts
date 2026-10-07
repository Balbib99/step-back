import { describe, expect, it } from 'vitest';
import { standingsTable } from '../test-support';
import { defaultConference, orDash, seasonLabel, zoneOf } from './standings';

describe('zoneOf', () => {
  it('gives direct play-offs to 1-6, play-in to 7-10 and nothing after', () => {
    expect([1, 6, 7, 10, 11, 15].map(zoneOf)).toEqual([
      'playoffs',
      'playoffs',
      'playin',
      'playin',
      'out',
      'out',
    ]);
  });
});

describe('seasonLabel', () => {
  it('names a season by its two years', () => {
    expect(seasonLabel(2027)).toBe('2026-27');
    expect(seasonLabel(2001)).toBe('2000-01');
  });
});

describe('defaultConference', () => {
  const tables = [standingsTable('east', 'regular'), standingsTable('west', 'regular')];

  it('is the conference of the first favourite, whatever the others', () => {
    expect(defaultConference(tables, ['MIN', 'PHI'])).toBe('west');
    expect(defaultConference(tables, ['PHI', 'MIN'])).toBe('east');
  });

  it('falls back to the East without favourites or tables', () => {
    expect(defaultConference(tables, [])).toBe('east');
    expect(defaultConference([], ['MIN'])).toBe('east');
  });
});

describe('orDash', () => {
  it('never writes null', () => {
    expect(orDash(null)).toBe('–');
    expect(orDash('W3')).toBe('W3');
  });
});
