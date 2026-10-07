import { describe, expect, it } from 'vitest';
import {
  contrastRatio as contrast,
  isTeamAbbr,
  NEUTRAL_PALETTE,
  onDarkColor,
  TEAM_ABBRS,
  TEAM_PALETTES,
} from './teams.js';

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

  it('has a colour for small marks on the dark background for every team', () => {
    for (const abbr of TEAM_ABBRS) expect(onDarkColor(abbr)).toMatch(/^#[0-9A-Fa-f]{6}$/);
  });

  it('picks the colour that shows up on dark, not the one that vanishes into it', () => {
    expect(onDarkColor('MIN')).toBe('#78BE20'); // field is midnight blue, the green is the visible one
    expect(onDarkColor('LAL')).toBe('#FDB927');
    expect(onDarkColor('PHI')).toBe('#E01445'); // numeral is white (no hue), the red field shows
  });

  it('falls back to the numeral for black-and-white teams and to neutral for unknown ones', () => {
    expect(onDarkColor('BKN')).toBe(TEAM_PALETTES.BKN.numeral);
    expect(onDarkColor('LON')).toBe(NEUTRAL_PALETTE.numeral);
  });

  it('measures contrast on the WCAG scale', () => {
    expect(contrast('#000000', '#FFFFFF')).toBeCloseTo(21, 0);
    expect(contrast('#777777', '#777777')).toBe(1);
  });
});
