import type { Game } from '@step-back/shared';
import { localDay } from './dates';

/** Team filter: the owner's favourites, every team, or one team by abbreviation. */
export type TeamFilter = 'mis' | 'todos' | (string & {});
export type PhaseFilter = 'pretemporada' | 'temporada' | undefined;

const PHASE_TO_SEASON_TYPE = {
  pretemporada: ['preseason'],
  temporada: ['regular', 'playoffs'],
} as const;

export function involves(game: Game, abbrs: readonly string[]): boolean {
  return abbrs.includes(game.home.abbr) || abbrs.includes(game.away.abbr);
}

export function filterGames(
  games: readonly Game[],
  filters: { team: TeamFilter; phase: PhaseFilter; favorites: readonly string[] },
): Game[] {
  const { team, phase, favorites } = filters;
  return games.filter((game) => {
    if (team === 'mis' && !involves(game, favorites)) return false;
    if (team !== 'mis' && team !== 'todos' && !involves(game, [team])) return false;
    if (phase && !(PHASE_TO_SEASON_TYPE[phase] as readonly string[]).includes(game.seasonType)) {
      return false;
    }
    return true;
  });
}

/** Games grouped by their local day. */
export function groupByDay(games: readonly Game[], timeZone: string): Map<string, Game[]> {
  const days = new Map<string, Game[]>();
  for (const game of games) {
    const day = localDay(game.startUtc, timeZone);
    days.set(day, [...(days.get(day) ?? []), game]);
  }
  return days;
}

/** Which favourites play in these games, in the order the favourites are configured. */
export function favouritesPlaying(games: readonly Game[], favorites: readonly string[]): string[] {
  return favorites.filter((abbr) => games.some((game) => involves(game, [abbr])));
}
