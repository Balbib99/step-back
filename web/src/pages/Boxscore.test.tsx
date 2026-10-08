import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { api, boxscoreOf, player, renderRoute, stubApi } from '../test-support';

// The player numbers on the game screen. In the shared games, 'final' is MIN 104 - LAL 99 and
// 'live' is BOS at PHI; the favourites are MIN, LAL and PHI.

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-10-07T10:00:00Z'));
  stubApi();
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

const players = () => screen.findByRole('region', { name: 'Estadísticas de jugadores' });
const table = (name: string) => screen.findByRole('table', { name });
const rowOf = (within_: HTMLElement, name: string) =>
  within(within_)
    .getAllByRole('row')
    .find((row) => row.textContent?.startsWith(name))!;

describe('Estadísticas de jugadores', () => {
  it('shows the numbers of the first favourite of the game, with the columns of a box score', async () => {
    renderRoute('/partido/final');
    const grid = await table('Estadísticas de Minnesota Timberwolves');

    expect(
      within(grid.querySelector('thead')!)
        .getAllByRole('columnheader')
        .map((c) => c.textContent),
    ).toEqual([
      'Jugador',
      'MIN',
      'PTS',
      'REB',
      'AST',
      'ROB',
      'TAP',
      'PER',
      'TC',
      'T3',
      'TL',
      '+/-',
    ]);
    const edwards = rowOf(grid, 'A. Edwards');
    expect(
      within(edwards)
        .getAllByRole('cell')
        .map((c) => c.textContent),
    ).toEqual(['30', '28', '5', '4', '1', '0', '2', '8-15', '2-5', '4-4', '+7']);
  });

  it('separates the starters from the bench, and ends with the totals of the team', async () => {
    renderRoute('/partido/final');
    const grid = await table('Estadísticas de Minnesota Timberwolves');

    const order = within(grid)
      .getAllByRole('row')
      .map((row) => row.textContent ?? '');
    const at = (text: string) => order.findIndex((row) => row.startsWith(text));
    expect(at('Quinteto titular')).toBeLessThan(at('A. Edwards'));
    expect(at('R. Gobert')).toBeLessThan(at('Banquillo'));
    expect(at('Banquillo')).toBeLessThan(at('N. Reid'));
    expect(order.at(-1)).toMatch(/^Total–49/); // no minutes for a team; 28 + 12 + 9 points
  });

  it('puts the top scorer in bold, and only him', async () => {
    renderRoute('/partido/final');
    const grid = await table('Estadísticas de Minnesota Timberwolves');
    const points = (name: string) => within(rowOf(grid, name)).getAllByRole('cell')[1]!;
    expect(points('A. Edwards')).toHaveClass('font-bold');
    expect(points('R. Gobert')).not.toHaveClass('font-bold');
  });

  it('says who did not play and why, in Spanish, outside the table', async () => {
    renderRoute('/partido/final');
    const grid = await table('Estadísticas de Minnesota Timberwolves');
    expect(within(grid).queryByText('J. McLaughlin')).not.toBeInTheDocument();
    expect(await screen.findByText(/J\. McLaughlin \(decisión técnica\)/)).toBeInTheDocument();
  });

  it('switches to the other team', async () => {
    const user = userEvent.setup();
    renderRoute('/partido/final');
    await table('Estadísticas de Minnesota Timberwolves');

    await user.click(within(await players()).getByRole('button', { name: 'LAL' }));

    const grid = await table('Estadísticas de Los Angeles Lakers');
    expect(rowOf(grid, 'L. Doncic')).toBeDefined();
    expect(within(grid).queryByText('A. Edwards')).not.toBeInTheDocument();
    expect(within(await players()).getByRole('button', { name: 'LAL' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
  });

  it('opens on the favourite when only one of the two teams is', async () => {
    renderRoute('/partido/live'); // BOS at PHI
    await table('Estadísticas de Philadelphia 76ers');
  });

  it('is there for a game that is on, and says it is updated', async () => {
    renderRoute('/partido/live');
    await table('Estadísticas de Philadelphia 76ers');
    expect(screen.getByText(/Se actualiza cada medio minuto/)).toBeInTheDocument();
  });

  it('is not there for a game that has not started', async () => {
    renderRoute('/partido/other');
    await screen.findByRole('article');
    expect(
      screen.queryByRole('region', { name: 'Estadísticas de jugadores' }),
    ).not.toBeInTheDocument();
    expect(api.requests.some((url) => url.includes('/boxscore'))).toBe(false);
  });

  it('explains that ESPN has no numbers yet, instead of an empty table', async () => {
    api.boxscore = {
      gameId: 'final',
      away: null,
      home: null,
      updatedAt: '2026-10-07T10:00:00.000Z',
    };
    renderRoute('/partido/final');
    expect(await screen.findByText(/Aún no hay estadísticas de este partido/)).toBeInTheDocument();
    expect(screen.queryByRole('table', { name: /Estadísticas de/ })).not.toBeInTheDocument();
  });

  it('shows a loading placeholder first', async () => {
    renderRoute('/partido/final');
    expect(
      await screen.findByRole('status', { name: 'Cargando estadísticas' }),
    ).toBeInTheDocument();
    await table('Estadísticas de Minnesota Timberwolves');
  });

  it('says so, with a way to retry, when the numbers cannot be loaded; the rest of the game stays', async () => {
    const user = userEvent.setup();
    api.boxscore = 502;
    renderRoute('/partido/final');

    expect(await screen.findByText(/No se pudieron cargar las estadísticas/)).toBeInTheDocument();
    expect(
      await screen.findByRole('article', { name: /Minnesota Timberwolves 104/ }),
    ).toBeInTheDocument();

    api.boxscore = 'default';
    await user.click(screen.getByRole('button', { name: 'Reintentar' }));
    await table('Estadísticas de Minnesota Timberwolves');
  });

  it('shows dashes for a player who has not had numbers yet, and never "null"', async () => {
    api.boxscore = (() => {
      const box = boxscoreOf('final');
      box.away!.players[2] = player('MIN3', 'N. Reid', 0, {
        starter: false,
        minutes: null,
        points: null,
        rebounds: null,
        assists: null,
        steals: null,
        blocks: null,
        turnovers: null,
        fieldGoals: null,
        threePointers: null,
        freeThrows: null,
        plusMinus: null,
      });
      return box;
    })();
    renderRoute('/partido/final');
    const grid = await table('Estadísticas de Minnesota Timberwolves');
    expect(rowOf(grid, 'N. Reid').textContent).toBe('N. Reid' + 'G' + '–'.repeat(11));
    expect(grid.textContent).not.toMatch(/null|undefined|NaN/);
  });

  it('keeps the page usable on a phone: the table scrolls sideways inside its own box', async () => {
    renderRoute('/partido/final');
    const grid = await table('Estadísticas de Minnesota Timberwolves');
    expect(grid.parentElement).toHaveClass('overflow-x-auto');
    await waitFor(() => expect(grid.className).toContain('min-w-'));
  });
});
