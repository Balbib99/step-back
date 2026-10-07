import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { api, highlight, HIGHLIGHTS, renderRoute, stubApi, where } from '../test-support';

const posts = () => screen.queryAllByRole('article');
const titles = () => posts().map((post) => post.getAttribute('aria-label'));
const lastRequest = () => api.requests.filter((url) => url.startsWith('/api/highlights?')).at(-1);

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-10-07T10:00:00Z'));
  stubApi();
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('Jugadas · the feed', () => {
  it('shows a placeholder while loading, then the videos', async () => {
    renderRoute('/jugadas');
    expect(screen.getByRole('status', { name: 'Cargando jugadas' })).toBeInTheDocument();
    await screen.findAllByRole('article');
    expect(screen.queryByRole('status', { name: 'Cargando jugadas' })).not.toBeInTheDocument();
  });

  it('starts on "Mis equipos": only videos about a favourite', async () => {
    renderRoute('/jugadas');
    await screen.findAllByRole('article');
    expect(titles()).toEqual([
      'LAKERS at WARRIORS | FULL GAME HIGHLIGHTS',
      'Embiid vuelve a anotar',
      'Timberwolves clip',
    ]);
    expect(lastRequest()).toContain('team=MIN%2CLAL%2CPHI');
  });

  it('shows everything with "Todas" and keeps it in the address', async () => {
    const user = userEvent.setup();
    renderRoute('/jugadas');
    await screen.findAllByRole('article');
    await user.click(screen.getByRole('button', { name: 'Todas' }));
    await waitFor(() => expect(posts()).toHaveLength(4));
    expect(where()).toBe('/jugadas?equipo=todos');
    expect(lastRequest()).not.toContain('team=');
  });

  it('filters by one team, and goes back to the default without leaving it in the address', async () => {
    const user = userEvent.setup();
    renderRoute('/jugadas');
    await screen.findAllByRole('article');
    await user.click(screen.getByRole('button', { name: 'PHI' }));
    await waitFor(() => expect(titles()).toEqual(['Embiid vuelve a anotar']));
    expect(where()).toBe('/jugadas?equipo=PHI');

    await user.click(screen.getByRole('button', { name: 'Mis equipos' }));
    await waitFor(() => expect(posts()).toHaveLength(3));
    expect(where()).toBe('/jugadas');
  });
});

describe('Jugadas · a post', () => {
  const open = async () => {
    renderRoute('/jugadas?equipo=todos');
    await waitFor(() => expect(posts()).toHaveLength(4));
  };
  const post = (title: string) => posts().find((p) => p.getAttribute('aria-label') === title)!;

  it('tells a game summary from a single play, with the source and how long ago', async () => {
    await open();
    const summary = post('LAKERS at WARRIORS | FULL GAME HIGHLIGHTS');
    expect(within(summary).getByText('Resumen del partido')).toBeInTheDocument();
    expect(within(summary).getByText('NBA')).toBeInTheDocument();
    expect(within(summary).getByText('hace 3 h')).toBeInTheDocument();
    expect(within(post('Embiid vuelve a anotar')).getByText('Jugada')).toBeInTheDocument();
  });

  it('has the team band of its game, and a plain one when it names no team', async () => {
    await open();
    expect(
      post('LAKERS at WARRIORS | FULL GAME HIGHLIGHTS').querySelector('[data-team]'),
    ).toHaveAttribute('data-team', 'LAL');
    expect(post('Top 5 plays of the night').querySelector('[data-team]')).toBeNull();
  });

  it('shows the thumbnail from this server and loads nothing from YouTube until it is pressed', async () => {
    await open();
    const card = post('Embiid vuelve a anotar');
    const play = within(card).getByRole('button', { name: 'Reproducir Embiid vuelve a anotar' });
    expect(play.querySelector('img')).toHaveAttribute('src', '/api/highlights/2/thumb');
    expect(card.querySelector('iframe')).toBeNull();
  });

  it('plays the video in place with the privacy-friendly player', async () => {
    const user = userEvent.setup();
    await open();
    const card = post('Embiid vuelve a anotar');
    await user.click(within(card).getByRole('button', { name: /Reproducir/ }));

    const frame = card.querySelector('iframe')!;
    expect(frame).toHaveAttribute(
      'src',
      'https://www.youtube-nocookie.com/embed/video000002?autoplay=1&playsinline=1&rel=0',
    );
    expect(frame).toHaveAttribute('title', 'Embiid vuelve a anotar');
    expect(frame.getAttribute('allow')).toContain('fullscreen');
    expect(frame).toHaveAttribute('referrerpolicy', 'strict-origin-when-cross-origin');
    expect(within(card).queryByRole('button', { name: /Reproducir/ })).toBeNull();
  });

  it('keeps the play button when the thumbnail cannot be loaded', async () => {
    await open();
    const card = post('Embiid vuelve a anotar');
    const button = within(card).getByRole('button', { name: /Reproducir/ });
    const { fireEvent } = await import('@testing-library/react');
    fireEvent.error(button.querySelector('img')!);
    expect(button.querySelector('img')).toBeNull();
    expect(button).toBeInTheDocument();
  });

  it('links to the video on YouTube in a new tab', async () => {
    await open();
    const link = within(post('Top 5 plays of the night')).getByRole('link', {
      name: 'Ver en YouTube',
    });
    expect(link).toHaveAttribute('href', 'https://www.youtube.com/watch?v=video000004');
    expect(link).toHaveAttribute('target', '_blank');
    expect(link).toHaveAttribute('rel', 'noopener noreferrer');
  });
});

describe('Jugadas · empty, error and paging', () => {
  it('says there are no plays yet for a team, and offers every team', async () => {
    const user = userEvent.setup();
    api.highlights = [highlight(1, { teams: ['DEN'] })];
    renderRoute('/jugadas');
    expect(await screen.findByText(/Aún sin jugadas de este equipo/)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Ver todas las jugadas' }));
    await screen.findByRole('article');
    expect(where()).toBe('/jugadas?equipo=todos');
  });

  it('says nothing has come out yet when the channel has no videos at all', async () => {
    api.highlights = [];
    renderRoute('/jugadas?equipo=todos');
    expect(await screen.findByText(/Todavía no hay jugadas/)).toBeInTheDocument();
  });

  it('offers a retry when the server fails', async () => {
    const user = userEvent.setup();
    api.highlights = 500;
    renderRoute('/jugadas?equipo=todos');
    expect(await screen.findByText(/No se pudieron cargar las jugadas/)).toBeInTheDocument();
    api.highlights = HIGHLIGHTS;
    await user.click(screen.getByRole('button', { name: 'Reintentar' }));
    await waitFor(() => expect(posts()).toHaveLength(4));
  });

  it('loads older videos on demand', async () => {
    const user = userEvent.setup();
    api.highlightsPageSize = 3;
    renderRoute('/jugadas?equipo=todos');
    await waitFor(() => expect(posts()).toHaveLength(3));
    await user.click(screen.getByRole('button', { name: 'Cargar más' }));
    await waitFor(() => expect(posts()).toHaveLength(4));
    expect(screen.queryByRole('button', { name: 'Cargar más' })).not.toBeInTheDocument();
    expect(new Set(titles()).size).toBe(4);
  });
});
