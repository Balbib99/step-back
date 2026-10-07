import type { Game, GameTeam } from '@step-back/shared';
import { describe, expect, it } from 'vitest';
import { gameStatusText } from './MiniGame';

const side = (abbr: string): GameTeam => ({
  teamId: abbr,
  abbr,
  name: abbr,
  score: null,
  record: null,
  winner: null,
  linescores: [],
});

const base: Game = {
  id: '1',
  season: 2027,
  seasonType: 'preseason',
  startUtc: '2026-10-07T23:00:00.000Z',
  status: 'scheduled',
  statusDetail: '',
  period: null,
  clock: null,
  venue: null,
  home: side('IND'),
  away: side('MIN'),
};

const text = (changes: Partial<Game>) => gameStatusText({ ...base, ...changes }, 'Europe/Madrid');

describe('gameStatusText', () => {
  it('shows the Madrid start time of a game that has not started', () => {
    expect(text({})).toEqual({ main: '01:00', sub: 'Pretemp.', live: false });
  });

  it('names the phase under the status', () => {
    expect(text({ seasonType: 'regular' }).sub).toBe('Temporada');
    expect(text({ seasonType: 'playoffs' }).sub).toBe('Playoffs');
  });

  it('shows quarter and clock while live', () => {
    expect(text({ status: 'live', period: 3, clock: '4:12' })).toEqual({
      main: 'Q3 4:12',
      sub: 'En juego',
      live: true,
    });
  });

  it('names overtime periods and halftime', () => {
    expect(text({ status: 'live', period: 5, clock: '2:30' }).main).toBe('PR1 2:30');
    expect(text({ status: 'live', period: 6, clock: '0:45' }).main).toBe('PR2 0:45');
    expect(text({ status: 'live', period: 2, clock: '0:00', statusDetail: 'Halftime' }).main).toBe(
      'Descanso',
    );
  });

  it('says final, postponed and canceled in Spanish', () => {
    expect(text({ status: 'final' }).main).toBe('Final');
    expect(text({ status: 'postponed' }).main).toBe('Aplazado');
    expect(text({ status: 'canceled' }).main).toBe('Cancelado');
  });
});
