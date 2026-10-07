import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { api, renderRoute, standingsTable, stubApi, where } from '../test-support';

const rows = () => within(screen.getByRole('list')).getAllByRole('listitem');
const rowNames = () => rows().map((row) => row.getAttribute('aria-label'));

beforeEach(() => stubApi());
afterEach(() => vi.unstubAllGlobals());

describe('Clasificación', () => {
  it('shows a placeholder while loading, then the table', async () => {
    renderRoute('/clasificacion');
    expect(screen.getByRole('status', { name: 'Cargando clasificación' })).toBeInTheDocument();
    await screen.findByRole('list');
    expect(
      screen.queryByRole('status', { name: 'Cargando clasificación' }),
    ).not.toBeInTheDocument();
  });

  it('opens on the conference of the first favourite (Minnesota: the West)', async () => {
    renderRoute('/clasificacion');
    await screen.findByRole('list', { name: 'Clasificación del Oeste' });
    expect(rowNames()).toEqual([
      '1. Denver Nuggets, 4-0',
      '2. Minnesota Timberwolves, 3-1',
      '3. Los Angeles Lakers, 2-2',
      '4. Portland Trail Blazers, 1-3',
    ]);
    expect(screen.getByRole('button', { name: 'Oeste' })).toHaveAttribute('aria-pressed', 'true');
  });

  it('gives record, percentage, home and road, last 10 and streak for each team', async () => {
    renderRoute('/clasificacion');
    await screen.findByRole('list');
    const min = rows()[1]!;
    expect(min).toHaveTextContent('Timberwolves');
    expect(min).toHaveTextContent('3-1');
    expect(min).toHaveTextContent('.750');
    expect(min).toHaveTextContent('2-11-1'); // home above road
    expect(min).toHaveTextContent('W2');
  });

  it('switches conference and keeps it in the address; the default stays out of it', async () => {
    const user = userEvent.setup();
    renderRoute('/clasificacion');
    await screen.findByRole('list', { name: 'Clasificación del Oeste' });

    await user.click(screen.getByRole('button', { name: 'Este' }));
    expect(await screen.findByRole('list', { name: 'Clasificación del Este' })).toBeInTheDocument();
    expect(where()).toBe('/clasificacion?conferencia=este');
    expect(rowNames()[0]).toBe('1. Boston Celtics, 4-0');

    await user.click(screen.getByRole('button', { name: 'Oeste' }));
    expect(where()).toBe('/clasificacion');
  });

  it('opens the conference written in the address', async () => {
    renderRoute('/clasificacion?conferencia=este');
    expect(await screen.findByRole('list', { name: 'Clasificación del Este' })).toBeInTheDocument();
  });

  it('highlights the favourite teams, and only them', async () => {
    renderRoute('/clasificacion');
    await screen.findByRole('list');
    expect(rows().map((r) => r.hasAttribute('data-favourite'))).toEqual([false, true, true, false]);
  });

  it('marks play-off and play-in zones in the regular season, with a legend', async () => {
    api.standings = [
      standingsTable('east', 'regular'),
      standingsTable('west', 'regular', [1, 6, 7, 11]),
    ];
    renderRoute('/clasificacion');
    await screen.findByRole('list');
    expect(rows().map((r) => r.getAttribute('data-zone'))).toEqual([
      'playoffs',
      'playoffs',
      'playin',
      'out',
    ]);
    expect(screen.getByText('Playoffs (1-6)')).toBeInTheDocument();
    expect(screen.getByText('Play-in (7-10)')).toBeInTheDocument();
    expect(screen.queryByRole('note')).not.toBeInTheDocument();
  });

  it('says it is the preseason table, shows no zones, and lets ties share a position', async () => {
    api.standings = [
      standingsTable('east', 'preseason'),
      standingsTable('west', 'preseason', [1, 2, 2, 4]),
    ];
    renderRoute('/clasificacion');
    await screen.findByRole('list');

    expect(screen.getByRole('note')).toHaveTextContent('Clasificación de pretemporada');
    expect(screen.getByRole('note')).toHaveTextContent('comparten posición');
    expect(rows().every((r) => !r.hasAttribute('data-zone'))).toBe(true);
    expect(screen.queryByText('Playoffs (1-6)')).not.toBeInTheDocument();
    expect(rowNames().slice(1, 3)).toEqual([
      '2. Minnesota Timberwolves, 3-1',
      '2. Los Angeles Lakers, 2-2',
    ]);
  });

  it('names the season', async () => {
    renderRoute('/clasificacion');
    expect(await screen.findByText('Temporada 2026-27')).toBeInTheDocument();
  });

  it('explains that nothing has been downloaded yet', async () => {
    api.standings = [];
    renderRoute('/clasificacion');
    expect(
      await screen.findByText(/Todavía no se ha descargado la clasificación/),
    ).toBeInTheDocument();
    expect(screen.queryByRole('list')).not.toBeInTheDocument();
  });

  it('offers a retry when the server fails', async () => {
    const user = userEvent.setup();
    api.standings = 500;
    renderRoute('/clasificacion');
    expect(await screen.findByText(/No se pudo cargar la clasificación/)).toBeInTheDocument();

    api.standings = [standingsTable('east', 'regular'), standingsTable('west', 'regular')];
    await user.click(screen.getByRole('button', { name: 'Reintentar' }));
    await waitFor(() => expect(screen.getByRole('list')).toBeInTheDocument());
  });
});
