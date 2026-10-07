import { describe, expect, it } from 'vitest';
import { isTeamAbbr, NEUTRAL_PALETTE, TEAM_ABBRS, TEAM_PALETTES } from './teams.js';

function luminance(hex: string): number {
  const [r, g, b] = [1, 3, 5].map((i) => {
    const channel = parseInt(hex.slice(i, i + 2), 16) / 255;
    return channel <= 0.03928 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
  }) as [number, number, number];
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function contrast(a: string, b: string): number {
  const [light, dark] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number];
  return (light + 0.05) / (dark + 0.05);
}

describe('team palettes', () => {
  it('covers the 30 NBA teams, including the three favourites', () => {
    expect(TEAM_ABBRS).toHaveLength(30);
    expect(TEAM_ABBRS).toEqual(expect.arrayContaining(['MIN', 'LAL', 'PHI']));
  });

  it('uses 6-digit hex colours everywhere', () => {
    for (const palette of [...Object.values(TEAM_PALETTES), NEUTRAL_PALETTE]) {
      for (const value of [palette.field, palette.ink, palette.numeral, palette.trim]) {
        expect(value).toMatch(/^#[0-9A-Fa-f]{6}$/);
      }
    }
  });

  // design.md: ink >= 4.5:1 and numeral >= 3:1 on the field.
  it.each(TEAM_ABBRS)('%s keeps its text readable on its field (WCAG AA)', (abbr) => {
    const { field, ink, numeral } = TEAM_PALETTES[abbr];
    expect(contrast(ink, field)).toBeGreaterThanOrEqual(4.5);
    expect(contrast(numeral, field)).toBeGreaterThanOrEqual(3);
  });

  it('keeps the neutral palette readable too', () => {
    expect(contrast(NEUTRAL_PALETTE.ink, NEUTRAL_PALETTE.field)).toBeGreaterThanOrEqual(4.5);
  });

  it('recognises team abbreviations', () => {
    expect(isTeamAbbr('MIN')).toBe(true);
    expect(isTeamAbbr('XXX')).toBe(false);
    expect(isTeamAbbr('_comment')).toBe(false);
  });
});
