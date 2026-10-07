import { isTeamAbbr, NEUTRAL_PALETTE, TEAM_PALETTES } from '@step-back/shared';
import type { CSSProperties } from 'react';

/**
 * Inline custom properties that paint an element as a team's jersey. Pair with the
 * `team-field` / `team-numeral` / `team-trim` classes. Unknown teams get the neutral palette.
 */
export function teamStyle(abbr: string): CSSProperties {
  const palette = isTeamAbbr(abbr) ? TEAM_PALETTES[abbr] : NEUTRAL_PALETTE;
  return {
    '--field': palette.field,
    '--ink': palette.ink,
    '--numeral': palette.numeral,
    '--trim': palette.trim,
  } as CSSProperties;
}
