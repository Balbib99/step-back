import type { Game, GameTeam } from '@step-back/shared';

export const TIP_OFF = Date.parse('2026-10-08T01:30:00Z');

export const side = (
  abbr: string,
  score: number | null = null,
  winner: boolean | null = null,
): GameTeam => ({
  teamId: abbr,
  abbr,
  name: abbr,
  score,
  record: null,
  winner,
  linescores: [],
});

export function game(extra: Partial<Game> = {}, away = 'MIN', home = 'LAL'): Game {
  return {
    id: '1001',
    season: 2027,
    seasonType: 'preseason',
    startUtc: new Date(TIP_OFF).toISOString(),
    status: 'scheduled',
    statusDetail: '',
    period: null,
    clock: null,
    venue: null,
    away: side(away),
    home: side(home),
    ...extra,
  };
}
