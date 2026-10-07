import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { api, renderRoute, standingsTable, stubApi, where } from '../test-support';

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-10-07T10:00:00Z'));
  stubApi();
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

const articles = () => screen.queryAllByRole('article');
const names = () => articles().map((a) => a.getAttribute('aria-label'));

describe('Equipo · header', () => {
  it('shows the team in its own colours, with its record and place', async () => {
    renderRoute('/equipo/MIN');
    const header = await screen.findByRole('region', { name: 'Minnesota Timberwolves' });
    expect(header).toHaveAttribute('data-team', 'MIN');
    // The fake standings have MIN second in the west, 3-1; the table is a regular-season one.
    await waitFor(() =>
      expect(within(header).getByLabelText('Victorias y derrotas')).toHaveTextContent('3-1'),
    );
    expect(within(header).getByText('2º del Oeste')).toBeInTheDocument();
  });

  it('says it is the preseason table in preseason, instead of a place', async () => {
    api.standings = [standingsTable('east', 'preseason'), standingsTable('west', 'preseason')];
    renderRoute('/equipo/MIN');
    const header = await screen.findByRole('region', { name: 'Minnesota Timberwolves' });
    expect(await within(header).findByText('Pretemporada 2026-27')).toBeInTheDocument();
  });

  it('works without a record: before the standings are downloaded', async () => {
    api.standings = [];
    renderRoute('/equipo/MIN');
    const header = await screen.findByRole('region', { name: 'Minnesota Timberwolves' });
    expect(within(header).queryByLabelText('Victorias y derrotas')).toBeNull();
  });

  it('accepts the abbreviation in lower case', async () => {
    renderRoute('/equipo/min');
    expect(
      await screen.findByRole('region', { name: 'Minnesota Timberwolves' }),
    ).toBeInTheDocument();
  });

  it('says an unknown team does not exist', async () => {
    renderRoute('/equipo/XYZ');
    expect(await screen.findByText(/Ese equipo no existe/)).toBeInTheDocument();
    expect(api.requests.some((url) => url.startsWith('/api/news'))).toBe(false);
  });
});

describe('Equipo · tabs', () => {
  it('opens on the news of the team, and nothing else is asked for yet', async () => {
    renderRoute('/equipo/LAL');
    await waitFor(() => expect(articles().length).toBeGreaterThan(0));
    expect(names()).toEqual([
      'Lakers ganan en la prórroga',
      'Game Highlights: Timberwolves vs. Lakers',
    ]);
    expect(screen.getByRole('tab', { name: 'Noticias' })).toHaveAttribute('aria-selected', 'true');
    expect(api.requests.some((url) => url.startsWith('/api/highlights'))).toBe(false);
  });

  it('shows the videos of the team in the second tab, and keeps the tab in the address', async () => {
    const user = userEvent.setup();
    renderRoute('/equipo/LAL');
    await screen.findByRole('tab', { name: 'Jugadas' });
    await user.click(screen.getByRole('tab', { name: 'Jugadas' }));

    await waitFor(() => expect(names()).toEqual(['LAKERS at WARRIORS | FULL GAME HIGHLIGHTS']));
    expect(where()).toBe('/equipo/LAL?pestana=jugadas');
    expect(api.requests.filter((u) => u.startsWith('/api/highlights?')).at(-1)).toContain(
      'team=LAL',
    );
  });

  it('opens the tab written in the address', async () => {
    renderRoute('/equipo/PHI?pestana=jugadas');
    await waitFor(() => expect(names()).toEqual(['Embiid vuelve a anotar']));
    expect(screen.getByRole('tab', { name: 'Jugadas' })).toHaveAttribute('aria-selected', 'true');
  });

  it('goes back to the first tab without leaving it in the address', async () => {
    const user = userEvent.setup();
    renderRoute('/equipo/LAL?pestana=jugadas');
    await user.click(await screen.findByRole('tab', { name: 'Noticias' }));
    expect(where()).toBe('/equipo/LAL');
  });

  it('says there is nothing for a team without news or videos', async () => {
    const user = userEvent.setup();
    renderRoute('/equipo/BOS');
    expect(await screen.findByText('Todavía no hay noticias de este equipo.')).toBeInTheDocument();
    await user.click(screen.getByRole('tab', { name: 'Jugadas' }));
    expect(await screen.findByText(/Aún sin jugadas de este equipo/)).toBeInTheDocument();
  });

  it('loads more news on demand', async () => {
    const user = userEvent.setup();
    api.newsPageSize = 1;
    renderRoute('/equipo/LAL');
    await waitFor(() => expect(articles()).toHaveLength(1));
    await user.click(screen.getByRole('button', { name: 'Cargar más' }));
    await waitFor(() => expect(articles()).toHaveLength(2));
    expect(screen.queryByRole('button', { name: 'Cargar más' })).not.toBeInTheDocument();
  });
});

describe('Equipo · calendar', () => {
  it('lists the games to play first and the results after, latest result first', async () => {
    const user = userEvent.setup();
    renderRoute('/equipo/MIN');
    await user.click(await screen.findByRole('tab', { name: 'Calendario' }));

    await screen.findByRole('heading', { name: 'Próximos' });
    expect(screen.getByRole('heading', { name: 'Resultados' })).toBeInTheDocument();
    expect(names()).toEqual([
      'Minnesota Timberwolves en Indiana Pacers, 23:30'.replace('23:30', '01:30'),
      'Minnesota Timberwolves 104, Los Angeles Lakers 99, Final',
    ]);
    expect(where()).toBe('/equipo/MIN?pestana=calendario');
  });

  it('opens a game from its row', async () => {
    const user = userEvent.setup();
    renderRoute('/equipo/MIN?pestana=calendario');
    await user.click(
      await screen.findByRole('link', {
        name: 'Ver el partido: Minnesota Timberwolves 104, Los Angeles Lakers 99, Final',
      }),
    );
    expect(where()).toBe('/partido/final');
  });

  it('says so when the team has no games stored', async () => {
    renderRoute('/equipo/BOS?pestana=calendario');
    // The fake league has a live game of Boston: use a team without any.
    await screen.findByRole('tab', { name: 'Calendario' });
    api.games = [];
    renderRoute('/equipo/DEN?pestana=calendario');
    expect(await screen.findAllByText(/no tiene partidos guardados/)).not.toHaveLength(0);
  });
});

describe('opening a team from the other screens', () => {
  it('Clasificación: pressing a team opens it', async () => {
    const user = userEvent.setup();
    renderRoute('/clasificacion');
    await user.click(await screen.findByRole('link', { name: 'Ver Minnesota Timberwolves' }));
    expect(where()).toBe('/equipo/MIN');
  });

  it('Noticias: pressing the team band of a post opens it', async () => {
    const user = userEvent.setup();
    renderRoute('/noticias?equipo=PHI');
    await user.click(await screen.findByRole('link', { name: 'Ver Philadelphia 76ers' }));
    expect(where()).toBe('/equipo/PHI');
  });

  it('Hoy: pressing the badge of a favourite that does not play today opens it', async () => {
    const user = userEvent.setup();
    // Only a Minnesota game, next week: the three favourites have nothing today.
    api.games = api.games
      .filter((g) => g.id === 'regular')
      .map((g) => ({ ...g, startUtc: '2026-10-15T23:30:00Z' }));
    renderRoute('/');
    await user.click(await screen.findByRole('link', { name: 'Ver MIN' }));
    expect(where()).toBe('/equipo/MIN');
  });
});
