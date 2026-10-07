import rawPalettes from './team-palettes.json';

export interface TeamPalette {
  name: string;
  /** Lane / band background. */
  field: string;
  /** Text on the field. */
  ink: string;
  /** Score, abbreviation and accent on the field. */
  numeral: string;
  /** Stripe. */
  trim: string;
}

export type TeamAbbr = Exclude<keyof typeof rawPalettes, '_comment'>;

/** Palettes of the 30 NBA teams, keyed by ESPN abbreviation. Source: team-palettes.json. */
export const TEAM_PALETTES = Object.fromEntries(
  Object.entries(rawPalettes).filter(([key]) => !key.startsWith('_')),
) as Record<TeamAbbr, TeamPalette>;

export const TEAM_ABBRS = Object.keys(TEAM_PALETTES) as TeamAbbr[];

export function isTeamAbbr(value: string): value is TeamAbbr {
  return Object.hasOwn(TEAM_PALETTES, value);
}

/** Neutral palette for league-wide content and for teams that are not known. */
export const NEUTRAL_PALETTE: TeamPalette = {
  name: 'NBA',
  field: '#232733',
  ink: '#EEF0F3',
  numeral: '#EEF0F3',
  trim: '#3A4050',
};

function channels(hex: string): [number, number, number] {
  return [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255) as [number, number, number];
}

function luminance(hex: string): number {
  const [r, g, b] = channels(hex).map((c) =>
    c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4,
  ) as [number, number, number];
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** WCAG contrast ratio between two #RRGGBB colours, 1 to 21. */
export function contrastRatio(a: string, b: string): number {
  const [light, dark] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number];
  return (light + 0.05) / (dark + 0.05);
}

function saturation(hex: string): number {
  const values = channels(hex);
  const max = Math.max(...values);
  return max === 0 ? 0 : (max - Math.min(...values)) / max;
}

const APP_GROUND = '#0E1015';

/**
 * A team's colour for small marks on the dark app background (calendar dots, side bars), where
 * the field itself often disappears: the most readable of its colours that still looks like a
 * colour. Teams whose palette is only black, white and grey (BKN, SA) get their numeral colour.
 */
export function onDarkColor(abbr: string, ground: string = APP_GROUND): string {
  const palette = isTeamAbbr(abbr) ? TEAM_PALETTES[abbr] : NEUTRAL_PALETTE;
  const candidates = [palette.field, palette.numeral, palette.trim]
    .filter((color) => saturation(color) >= 0.35 && contrastRatio(color, ground) >= 3)
    .sort((a, b) => contrastRatio(b, ground) - contrastRatio(a, ground));
  return candidates[0] ?? palette.numeral;
}
