import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { api, newsItem, NEWS, renderRoute, stubApi, where } from '../test-support';

const posts = () => screen.queryAllByRole('article');
const titles = () => posts().map((post) => post.getAttribute('aria-label'));
const lastNewsRequest = () => api.requests.filter((url) => url.startsWith('/api/news?')).at(-1);

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-10-07T10:00:00Z'));
  stubApi();
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('Noticias · the feed', () => {
  it('shows a placeholder while loading, then the posts', async () => {
    renderRoute('/noticias');
    expect(screen.getByRole('status', { name: 'Cargando noticias' })).toBeInTheDocument();
    await screen.findAllByRole('article');
    expect(screen.queryByRole('status', { name: 'Cargando noticias' })).not.toBeInTheDocument();
  });

  it('starts on "Mis equipos": only what is about a favourite, newest first', async () => {
    renderRoute('/noticias');
    await screen.findAllByRole('article');
    expect(titles()).toEqual([
      'Lakers ganan en la prórroga',
      'Game Highlights: Timberwolves vs. Lakers',
      'Embiid vuelve a entrenar',
    ]);
    expect(lastNewsRequest()).toContain('team=MIN%2CLAL%2CPHI');
  });

  it('shows every post with "Todas"', async () => {
    const user = userEvent.setup();
    renderRoute('/noticias');
    await screen.findAllByRole('article');
    await user.click(screen.getByRole('button', { name: 'Todas' }));
    await waitFor(() => expect(posts()).toHaveLength(5));
    expect(where()).toBe('/noticias?equipo=todos');
    expect(lastNewsRequest()).not.toContain('team=');
  });
});

describe('Noticias · a post', () => {
  const open = async () => {
    renderRoute('/noticias?equipo=todos');
    await waitFor(() => expect(posts()).toHaveLength(5));
  };
  const post = (title: string) => posts().find((p) => p.getAttribute('aria-label') === title)!;

  it('has the source, its language and how long ago it came out', async () => {
    await open();
    const spanish = post('Lakers ganan en la prórroga');
    expect(within(spanish).getByText('Gigantes del Basket')).toBeInTheDocument();
    expect(within(spanish).getByText('ES')).toBeInTheDocument();
    expect(within(spanish).getByText('hace 3 h')).toBeInTheDocument();
    expect(within(post('Embiid vuelve a entrenar')).getByText('EN')).toBeInTheDocument();
  });

  it('shows the summary only when there is one', async () => {
    await open();
    expect(
      within(post('Lakers ganan en la prórroga')).getByText('LeBron lidera la remontada.'),
    ).toBeInTheDocument();
    expect(post('Embiid vuelve a entrenar').querySelectorAll('p')).toHaveLength(1); // only the source line
  });

  it('paints the band with the team the post is about, and prefers a favourite', async () => {
    await open();
    const band = (title: string) => post(title).querySelector('[data-team]');
    expect(band('Lakers ganan en la prórroga')).toHaveAttribute('data-team', 'LAL');
    expect(band('Embiid vuelve a entrenar')).toHaveAttribute('data-team', 'PHI');
    // Denver and Golden State: neither is a favourite, so the first one named.
    expect(band('Nuggets contra Warriors')).toHaveAttribute('data-team', 'DEN');
    // Minnesota against the Lakers: both favourites, the first one named, the other beside it.
    expect(band('Game Highlights: Timberwolves vs. Lakers')).toHaveAttribute('data-team', 'MIN');
    expect(
      within(post('Game Highlights: Timberwolves vs. Lakers')).getByText('LAL'),
    ).toBeInTheDocument();
  });

  it('has a plain band for news about the league', async () => {
    await open();
    const rumours = post('Rumores del mercado de fichajes');
    expect(rumours.querySelector('[data-team]')).toBeNull();
    expect(within(rumours).getByText('NBA')).toBeInTheDocument();
  });

  it('shows a video with its play mark and a link to the source, never the third party', async () => {
    await open();
    const video = post('Game Highlights: Timberwolves vs. Lakers');
    const link = within(video).getByRole('link', { name: 'Ver vídeo en ESPN' });
    expect(link).toHaveAttribute('href', 'https://www.espn.com/story/2');
    expect(link).toHaveAttribute('target', '_blank');
    expect(link).toHaveAttribute('rel', 'noopener noreferrer');
    expect(within(video).getByText('Vídeo', { selector: 'span.rounded-full' })).toBeInTheDocument();
    expect(link.querySelector('img')).toHaveAttribute('src', '/api/news/2/image');
    expect(link).toHaveClass('aspect-video');
  });

  it('shows an image as an image, without the play mark', async () => {
    await open();
    const image = post('Embiid vuelve a entrenar');
    const link = within(image).getByRole('link', { name: 'Ver imagen en ESPN' });
    expect(link.querySelector('img')).toHaveAttribute('src', '/api/news/3/image');
    expect(link).not.toHaveTextContent('▶');
  });

  it('stays as text, with no empty frame, when there is no media', async () => {
    await open();
    const text = post('Rumores del mercado de fichajes');
    expect(text.querySelector('a[href] img')).toBeNull();
    expect(within(text).queryByRole('link', { name: /Ver/ })).toBeNull();
  });

  it('drops the picture when it cannot be loaded, instead of showing a broken frame', async () => {
    await open();
    const image = post('Embiid vuelve a entrenar');
    // The band has a crest, which is also an image: the picture is the one inside the link.
    const link = within(image).getByRole('link', { name: 'Ver imagen en ESPN' });
    fireEvent.error(link.querySelector('img')!);
    expect(within(image).queryByRole('link', { name: 'Ver imagen en ESPN' })).toBeNull();
  });

  it('links to the original in a new tab', async () => {
    await open();
    const link = within(post('Rumores del mercado de fichajes')).getByRole('link', {
      name: 'Abrir fuente',
    });
    expect(link).toHaveAttribute('href', 'https://www.espn.com/story/4');
    expect(link).toHaveAttribute('target', '_blank');
    expect(link).toHaveAttribute('rel', 'noopener noreferrer');
  });
});

describe('Noticias · filters', () => {
  it('filters by one team and keeps it in the address', async () => {
    const user = userEvent.setup();
    renderRoute('/noticias');
    await screen.findAllByRole('article');
    await user.click(screen.getByRole('button', { name: 'PHI' }));
    await waitFor(() => expect(titles()).toEqual(['Embiid vuelve a entrenar']));
    expect(where()).toBe('/noticias?equipo=PHI');
    expect(lastNewsRequest()).toContain('team=PHI');
  });

  it('shows only videos, and only Spanish, and both can be undone', async () => {
    const user = userEvent.setup();
    renderRoute('/noticias?equipo=todos');
    await waitFor(() => expect(posts()).toHaveLength(5));

    await user.click(screen.getByRole('button', { name: 'Vídeos' }));
    await waitFor(() => expect(posts()).toHaveLength(1));
    expect(where()).toBe('/noticias?equipo=todos&tipo=videos');
    expect(lastNewsRequest()).toContain('media=video');

    await user.click(screen.getByRole('button', { name: 'Vídeos' }));
    await user.click(screen.getByRole('button', { name: 'Español' }));
    await waitFor(() => expect(titles()).toEqual(['Lakers ganan en la prórroga']));
    expect(lastNewsRequest()).toContain('lang=es');

    await user.click(screen.getByRole('button', { name: 'Español' }));
    await waitFor(() => expect(posts()).toHaveLength(5));
    expect(where()).toBe('/noticias?equipo=todos');
  });

  it('filters by player from a post, and clears it', async () => {
    const user = userEvent.setup();
    renderRoute('/noticias?equipo=todos');
    await waitFor(() => expect(posts()).toHaveLength(5));

    await user.click(screen.getByRole('button', { name: 'Ver noticias de Joel Embiid' }));
    await waitFor(() => expect(titles()).toEqual(['Embiid vuelve a entrenar']));
    expect(where()).toContain('jugador=Joel+Embiid');
    expect(lastNewsRequest()).toContain('player=Joel+Embiid');
    expect(screen.getByText('Joel Embiid', { selector: 'strong' })).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Quitar el filtro de Joel Embiid' }));
    await waitFor(() => expect(posts()).toHaveLength(5));
    expect(where()).toBe('/noticias?equipo=todos');
  });

  it('opens with the filters written in the address', async () => {
    renderRoute('/noticias?equipo=LAL&idioma=es');
    await screen.findAllByRole('article');
    expect(titles()).toEqual(['Lakers ganan en la prórroga']);
    expect(screen.getByRole('button', { name: 'Español' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('button', { name: 'LAL' })).toHaveAttribute('aria-pressed', 'true');
  });

  it('falls back to every team when no favourites are configured', async () => {
    api.config = { ...(api.config as object), favoriteTeams: [] };
    renderRoute('/noticias');
    await waitFor(() => expect(posts()).toHaveLength(5));
    expect(screen.queryByRole('button', { name: 'Mis equipos' })).not.toBeInTheDocument();
  });
});

describe('Noticias · empty, error and paging', () => {
  it('explains an empty result of the filters and offers to clear them', async () => {
    const user = userEvent.setup();
    api.news = [newsItem(1, { teams: ['LAL'] })];
    renderRoute('/noticias?equipo=PHI');
    expect(await screen.findByText('No hay noticias con estos filtros.')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Ver todas las noticias' }));
    await screen.findByRole('article');
    expect(where()).toBe('/noticias');
  });

  it('says nothing has been downloaded yet when there is no news at all', async () => {
    api.news = [];
    renderRoute('/noticias?equipo=todos');
    expect(await screen.findByText(/Todavía no hay noticias/)).toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: 'Ver todas las noticias' }),
    ).not.toBeInTheDocument();
  });

  it('offers a retry when the server fails', async () => {
    const user = userEvent.setup();
    api.news = 500;
    renderRoute('/noticias?equipo=todos');
    expect(await screen.findByText(/No se pudieron cargar las noticias/)).toBeInTheDocument();

    api.news = NEWS;
    await user.click(screen.getByRole('button', { name: 'Reintentar' }));
    await waitFor(() => expect(posts()).toHaveLength(5));
  });

  it('loads older news on demand, a page at a time', async () => {
    const user = userEvent.setup();
    api.newsPageSize = 2;
    renderRoute('/noticias?equipo=todos');
    await waitFor(() => expect(posts()).toHaveLength(2));

    await user.click(screen.getByRole('button', { name: 'Cargar más' }));
    await waitFor(() => expect(posts()).toHaveLength(4));
    await user.click(screen.getByRole('button', { name: 'Cargar más' }));
    await waitFor(() => expect(posts()).toHaveLength(5));

    expect(screen.queryByRole('button', { name: 'Cargar más' })).not.toBeInTheDocument();
    expect(new Set(titles()).size).toBe(5); // no repeats
  });
});
