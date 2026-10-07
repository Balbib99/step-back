import type { Game } from '@step-back/shared';
import { formatClock } from './format';

const PHASE_SHORT: Record<Game['seasonType'], string> = {
  preseason: 'Pretemp.',
  regular: 'Temporada',
  playoffs: 'Playoffs',
};

const PHASE_LONG: Record<Game['seasonType'], string> = {
  preseason: 'Pretemporada',
  regular: 'Temporada',
  playoffs: 'Playoffs',
};

export const phaseLabel = (seasonType: Game['seasonType'], long = false): string =>
  (long ? PHASE_LONG : PHASE_SHORT)[seasonType];

/** Q1 to Q4, then PR1, PR2... for the overtimes (prórrogas). */
function periodLabel(period: number): string {
  return period <= 4 ? `Q${period}` : `PR${period - 4}`;
}

/** What a game says about itself, in Spanish: the main text (time, quarter, result) and a small one. */
export function gameStatusText(
  game: Game,
  timeZone: string,
): { main: string; sub: string; live: boolean } {
  const phase = PHASE_SHORT[game.seasonType];
  switch (game.status) {
    case 'live': {
      const halftime = /half/i.test(game.statusDetail);
      const main = halftime
        ? 'Descanso'
        : [game.period ? periodLabel(game.period) : '', game.clock ?? ''].filter(Boolean).join(' ');
      return { main: main || 'En juego', sub: 'En juego', live: true };
    }
    case 'final':
      return { main: 'Final', sub: phase, live: false };
    case 'postponed':
      return { main: 'Aplazado', sub: phase, live: false };
    case 'canceled':
      return { main: 'Cancelado', sub: phase, live: false };
    default:
      return { main: formatClock(game.startUtc, timeZone), sub: phase, live: false };
  }
}

/** The spoken name of a game for screen readers: teams, score if there is one, and status. */
export function gameLabel(game: Game, statusMain: string): string {
  const started = game.status === 'live' || game.status === 'final';
  return started
    ? `${game.away.name} ${game.away.score}, ${game.home.name} ${game.home.score}, ${statusMain}`
    : `${game.away.name} en ${game.home.name}, ${statusMain}`;
}
