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
