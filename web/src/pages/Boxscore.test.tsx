import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { api, boxscoreOf, player, renderRoute, stubApi } from '../test-support';

// The player numbers on the game screen. In the shared games, 'final' is MIN 104 - LAL 99 and
// 'live' is BOS at PHI; the favourites are MIN, LAL and PHI. Each fake team has two starters
// (A. Edwards 28 points, R. Gobert 12), a bench player (N. Reid) and one who did not play.

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-10-07T10:00:00Z'));
  stubApi();
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

const section = () => screen.findByRole('region', { name: 'Estadísticas de jugadores' });
const team = (name: string) => screen.findByRole('group', { name: `Estadísticas de ${name}` });
const card = (scope: HTMLElement, name: string) => within(scope).getByRole('article', { name });
const benchList = (scope: HTMLElement) => within(scope).getByRole('list', { name: 'Banquillo' });
const benchRow = (scope: HTMLElement, name: string) =>
  within(benchList(scope)).getByRole('listitem', { name });
const cardNames = (scope: HTMLElement) =>
  within(scope)
    .queryAllByRole('article')
    .map((a) => a.getAttribute('aria-label'));

describe('Estadísticas de jugadores · quinteto titular', () => {
  it('opens on the first favourite of the game, with a card for each starter', async () => {
    renderRoute('/partido/final');
    expect(cardNames(await team('Minnesota Timberwolves'))).toEqual(['A. Edwards', 'R. Gobert']);
  });

  it('gives the points, the minutes and the other numbers of a starter', async () => {
    renderRoute('/partido/final');
    const edwards = card(await team('Minnesota Timberwolves'), 'A. Edwards');

    expect(edwards).toHaveTextContent('28');
    expect(edwards).toHaveTextContent('PTS');
    expect(edwards).toHaveTextContent('30 min');
    // REB 5, AST 4, ROB 1, TAP 0, PER 2, each under its label.
    expect(edwards).toHaveTextContent('REB5AST4ROB1TAP0PER2');
  });

  it('marks the top scorer of the team, and only him', async () => {
    renderRoute('/partido/final');
    const minnesota = await team('Minnesota Timberwolves');
    expect(card(minnesota, 'A. Edwards')).toHaveTextContent('★ MÁX');
    expect(card(minnesota, 'R. Gobert')).not.toHaveTextContent('MÁX');
  });

  it('marks the top scorer of the team even when he came off the bench', async () => {
    api.boxscore = (() => {
      const box = boxscoreOf('final');
      box.away!.players[2] = player('MIN3', 'N. Reid', 40, { starter: false });
      return box;
    })();
    renderRoute('/partido/final');
    const minnesota = await team('Minnesota Timberwolves');
    expect(benchRow(minnesota, 'N. Reid')).toHaveTextContent('★ MÁX');
    expect(card(minnesota, 'A. Edwards')).not.toHaveTextContent('MÁX');
  });

  it('shows his position and his number on the team colour', async () => {
    renderRoute('/partido/final');
    const edwards = card(await team('Minnesota Timberwolves'), 'A. Edwards');
    expect(edwards).toHaveTextContent('G');
    expect(edwards.querySelector('.team-field')).not.toBeNull();
    expect(edwards.querySelector('[aria-hidden="true"]')).toHaveTextContent('1'); // his number
  });

  it('puts his photo in the card, from this server', async () => {
    renderRoute('/partido/final');
    const edwards = card(await team('Minnesota Timberwolves'), 'A. Edwards');
    const photo = edwards.querySelector('img')!;
    expect(photo).toHaveAttribute('src', '/api/players/MIN1/headshot');
    expect(photo).toHaveAttribute('alt', '');
    expect(photo).toHaveAttribute('loading', 'lazy');
  });

  it('shows his initials when there is no photo, and when the photo does not load', async () => {
    api.boxscore = (() => {
      const box = boxscoreOf('final');
      box.away!.players[0] = player('MIN1', 'A. Edwards', 28, { photoUrl: null });
      return box;
    })();
    renderRoute('/partido/final');
    const minnesota = await team('Minnesota Timberwolves');
    const edwards = card(minnesota, 'A. Edwards');
    expect(edwards.querySelector('img')).toBeNull();
    expect(edwards).toHaveTextContent('AE');

    const gobert = card(minnesota, 'R. Gobert');
    fireEvent.error(gobert.querySelector('img')!);
    await waitFor(() => expect(gobert.querySelector('img')).toBeNull());
    expect(gobert).toHaveTextContent('RG');
  });

  it('gives the last card the whole width when the number of starters is odd', async () => {
    api.boxscore = (() => {
      const box = boxscoreOf('final');
      box.away!.players.splice(2, 0, player('MIN9', 'K. Towns', 10));
      return box;
    })();
    renderRoute('/partido/final');
    const minnesota = await team('Minnesota Timberwolves');
    const items = within(within(minnesota).getAllByRole('list')[0]!).getAllByRole('listitem');
    expect(items).toHaveLength(3);
    expect(items.map((li) => li.className.includes('col-span-2'))).toEqual([false, false, true]);
  });
});

describe('Estadísticas de jugadores · banquillo', () => {
  it('has a row for each bench player with his points, minutes and numbers', async () => {
    renderRoute('/partido/final');
    const reid = benchRow(await team('Minnesota Timberwolves'), 'N. Reid');
    expect(reid).toHaveTextContent('9'); // points
    expect(reid).toHaveTextContent('12 min');
    expect(reid).toHaveTextContent('REB 5 · AST 4 · ROB 1 · TAP 0 · PER 2');
  });

  it('keeps the starters out of the bench and the bench out of the starters', async () => {
    renderRoute('/partido/final');
    const minnesota = await team('Minnesota Timberwolves');
    expect(within(benchList(minnesota)).queryByText('A. Edwards')).not.toBeInTheDocument();
    expect(cardNames(minnesota)).not.toContain('N. Reid');
  });

  it('explains the colours of the bars', async () => {
    renderRoute('/partido/final');
    const minnesota = await team('Minnesota Timberwolves');
    for (const label of ['Puntos', 'Rebotes', 'Asistencias']) {
      expect(within(minnesota).getByText(label)).toBeInTheDocument();
    }
  });

  it('draws the bar of each player in proportion to the best of his bench', async () => {
    api.boxscore = (() => {
      const box = boxscoreOf('final');
      box.away!.players.splice(
        3,
        0,
        player('MIN8', 'T. Shannon', 4, { starter: false, rebounds: 1, assists: 1 }),
      );
      return box;
    })();
    renderRoute('/partido/final');
    const minnesota = await team('Minnesota Timberwolves');
    const total = (name: string) =>
      [...benchRow(minnesota, name).querySelectorAll<HTMLElement>('[aria-hidden="true"] i')]
        .map((i) => parseFloat(i.style.width))
        .reduce((a, b) => a + b, 0);
    // N. Reid: 9 + 5 + 4 = 18 is the biggest; T. Shannon: 4 + 1 + 1 = 6.
    expect(total('N. Reid')).toBeCloseTo(100);
    expect(total('T. Shannon')).toBeCloseTo(33.3, 0);
  });

  it('is not there when nobody came off the bench', async () => {
    api.boxscore = (() => {
      const box = boxscoreOf('final');
      box.away!.players = box.away!.players.filter((p) => p.starter);
      return box;
    })();
    renderRoute('/partido/final');
    const minnesota = await team('Minnesota Timberwolves');
    expect(within(minnesota).queryByRole('list', { name: 'Banquillo' })).not.toBeInTheDocument();
  });
});

describe('Estadísticas de jugadores · el resto', () => {
  it('says who did not play and why, in Spanish', async () => {
    renderRoute('/partido/final');
    const minnesota = await team('Minnesota Timberwolves');
    expect(minnesota).toHaveTextContent('No han jugado: J. McLaughlin (decisión técnica).');
    expect(cardNames(minnesota)).not.toContain('J. McLaughlin');
  });

  it('ends with the totals of the team', async () => {
    renderRoute('/partido/final');
    const minnesota = await team('Minnesota Timberwolves');
    expect(minnesota).toHaveTextContent(
      'Equipo · 49 PTS · 30 REB · 20 AST · 6 ROB · 2 TAP · 11 PER',
    );
  });

  it('switches to the other team', async () => {
    const user = userEvent.setup();
    renderRoute('/partido/final');
    await team('Minnesota Timberwolves');

    await user.click(within(await section()).getByRole('button', { name: 'LAL' }));

    const lakers = await team('Los Angeles Lakers');
    expect(card(lakers, 'L. Doncic')).toBeInTheDocument();
    expect(within(lakers).queryByText('A. Edwards')).not.toBeInTheDocument();
    expect(within(await section()).getByRole('button', { name: 'LAL' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
  });

  it('opens on the favourite when only one of the two teams is', async () => {
    renderRoute('/partido/live'); // BOS at PHI
    await team('Philadelphia 76ers');
  });

  it('is there for a game that is on, and says it is updated', async () => {
    renderRoute('/partido/live');
    await team('Philadelphia 76ers');
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

  it('explains that ESPN has no numbers yet, instead of empty cards', async () => {
    api.boxscore = {
      gameId: 'final',
      away: null,
      home: null,
      updatedAt: '2026-10-07T10:00:00.000Z',
    };
    renderRoute('/partido/final');
    expect(await screen.findByText(/Aún no hay estadísticas de este partido/)).toBeInTheDocument();
    expect(screen.queryByRole('group', { name: /Estadísticas de/ })).not.toBeInTheDocument();
  });

  it('shows a loading placeholder first', async () => {
    renderRoute('/partido/final');
    expect(
      await screen.findByRole('status', { name: 'Cargando estadísticas' }),
    ).toBeInTheDocument();
    await team('Minnesota Timberwolves');
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
    await team('Minnesota Timberwolves');
  });

  it('shows dashes for a bench player without numbers, and never "null"', async () => {
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
      });
      return box;
    })();
    renderRoute('/partido/final');
    const reid = benchRow(await team('Minnesota Timberwolves'), 'N. Reid');
    expect(reid).toHaveTextContent('REB – · AST – · ROB – · TAP – · PER –');
    expect(reid.textContent).not.toMatch(/null|undefined|NaN/);
  });
});

describe('Estadísticas de jugadores · «Más datos»', () => {
  it('starts without the shooting and shows it when asked, for starters, bench and team', async () => {
    const user = userEvent.setup();
    renderRoute('/partido/final');
    const minnesota = await team('Minnesota Timberwolves');
    expect(minnesota).not.toHaveTextContent('TC 8-15');

    const toggle = within(await section()).getByRole('button', { name: 'Más datos' });
    expect(toggle).toHaveAttribute('aria-pressed', 'false');
    await user.click(toggle);

    expect(toggle).toHaveAttribute('aria-pressed', 'true');
    expect(card(minnesota, 'A. Edwards')).toHaveTextContent('TC 8-15 · T3 2-5 · TL 4-4 · +/- +7');
    expect(card(minnesota, 'R. Gobert')).toHaveTextContent('+/- -3');
    expect(benchRow(minnesota, 'N. Reid')).toHaveTextContent('TC 8-15 · T3 2-5 · TL 4-4');
    expect(minnesota).toHaveTextContent('TC 30-70 · T3 8-25 · TL 12-15');

    await user.click(toggle);
    expect(minnesota).not.toHaveTextContent('TC 8-15');
  });

  it('keeps the choice when switching team', async () => {
    const user = userEvent.setup();
    renderRoute('/partido/final');
    await team('Minnesota Timberwolves');
    await user.click(within(await section()).getByRole('button', { name: 'Más datos' }));
    await user.click(within(await section()).getByRole('button', { name: 'LAL' }));
    expect(card(await team('Los Angeles Lakers'), 'L. Doncic')).toHaveTextContent('TC 8-15');
  });
});
