import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { api, NEWS, renderRoute, SHORTS, stubApi, where } from '../test-support';

// Noticias has two views: the news, and the Shorts of the Spanish channels (Drafteados). The
// fake server has the usual five news items and three Shorts, the newest being about MIN.

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-10-07T10:00:00Z'));
  stubApi();
  api.news = [...NEWS, ...SHORTS];
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

const shorts = () => screen.findByRole('list', { name: 'Shorts' });
const titles = (list: HTMLElement) =>
  within(list)
    .getAllByRole('listitem')
    .map((li) => li.textContent);

describe('Noticias · vista Shorts', () => {
  it('has a switch between the news and the Shorts, on the news by default', async () => {
    renderRoute('/noticias');
    const switcher = await screen.findByRole('group', { name: 'Vista' });
    expect(within(switcher).getByRole('button', { name: 'Noticias' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    expect(within(switcher).getByRole('button', { name: 'Shorts' })).toHaveAttribute(
      'aria-pressed',
      'false',
    );
  });

  it('leaves the Shorts out of the news', async () => {
    renderRoute('/noticias?equipo=todos');
    await screen.findByRole('article', { name: 'Lakers ganan en la prórroga' });
    expect(screen.queryByText('Short 11')).not.toBeInTheDocument();
    expect(screen.queryByRole('list', { name: 'Shorts' })).not.toBeInTheDocument();
  });

  it('opens the Shorts with the button, and keeps the view in the address', async () => {
    const user = userEvent.setup();
    renderRoute('/noticias');
    await user.click(await screen.findByRole('button', { name: 'Shorts' }));

    expect(await shorts()).toBeInTheDocument();
    expect(where()).toBe('/noticias?vista=shorts');
    expect(screen.getByRole('button', { name: 'Shorts' })).toHaveAttribute('aria-pressed', 'true');
  });

  it('goes back to the news with the other button, and drops the Shorts filters', async () => {
    const user = userEvent.setup();
    renderRoute('/noticias?vista=shorts&equipo=MIN');
    await shorts();
    await user.click(screen.getByRole('button', { name: 'Noticias' }));
    await screen.findByRole('article', { name: 'Lakers ganan en la prórroga' });
    expect(where()).toBe('/noticias');
  });

  it('lists every Short, newest first, and nothing else', async () => {
    renderRoute('/noticias?vista=shorts');
    const list = await shorts();
    expect(within(list).getAllByRole('listitem')).toHaveLength(3);
    expect(titles(list).map((t) => t?.match(/Short \d+/)?.[0])).toEqual([
      'Short 11',
      'Short 12',
      'Short 13',
    ]);
    expect(within(list).queryByText(/Titular|Lakers ganan/)).not.toBeInTheDocument();
  });

  it('asks the server for Shorts only', async () => {
    renderRoute('/noticias?vista=shorts');
    await shorts();
    const asked = api.requests.filter((url) => url.startsWith('/api/news?'));
    expect(asked.length).toBeGreaterThan(0);
    expect(asked.every((url) => url.includes('shorts=only'))).toBe(true);
  });

  it('opens on all the teams, because most Shorts are about the league', async () => {
    renderRoute('/noticias?vista=shorts');
    await shorts();
    expect(screen.getByRole('button', { name: 'Todas' })).toHaveAttribute('aria-pressed', 'true');
    expect(api.requests.some((url) => url.includes('team='))).toBe(false);
  });

  it('filters by team, like the news', async () => {
    const user = userEvent.setup();
    renderRoute('/noticias?vista=shorts');
    await shorts();

    await user.click(screen.getByRole('button', { name: 'MIN' }));

    await waitFor(() =>
      expect(
        within(screen.getByRole('list', { name: 'Shorts' })).getAllByRole('listitem'),
      ).toHaveLength(1),
    );
    expect(where()).toBe('/noticias?vista=shorts&equipo=MIN');
    expect(screen.getByText('Short 11')).toBeInTheDocument();
  });

  it('has no type or language filters: they are about the news', async () => {
    renderRoute('/noticias?vista=shorts');
    await shorts();
    expect(screen.queryByRole('group', { name: 'Tipo' })).not.toBeInTheDocument();
    expect(screen.queryByRole('group', { name: 'Idioma' })).not.toBeInTheDocument();
  });

  it('shows the source and how long ago, over a vertical thumbnail', async () => {
    renderRoute('/noticias?vista=shorts');
    const first = within(await shorts()).getAllByRole('listitem')[0]!;
    expect(first).toHaveTextContent('Drafteados');
    expect(first).toHaveTextContent('hace 1 h');
    const picture = first.querySelector('img')!;
    expect(picture).toHaveAttribute('src', '/api/news/11/image');
    expect(picture.closest('button')!.className).toContain('aspect-[9/16]');
  });

  it('does not load anything from YouTube until a Short is pressed', async () => {
    renderRoute('/noticias?vista=shorts');
    await shorts();
    expect(document.querySelector('iframe')).toBeNull();
  });
});

describe('Noticias · reproducir un Short', () => {
  it('plays it in the official player, taking the whole width of the grid', async () => {
    const user = userEvent.setup();
    renderRoute('/noticias?vista=shorts');
    const list = await shorts();

    await user.click(within(list).getByRole('button', { name: 'Reproducir Short 12' }));

    const player = document.querySelector('iframe')!;
    expect(player).toHaveAttribute('title', 'Short 12');
    expect(player.getAttribute('src')).toBe(
      'https://www.youtube-nocookie.com/embed/short12?autoplay=1&playsinline=1&rel=0',
    );
    expect(player).toHaveAttribute('allowfullscreen');
    expect(player.closest('li')!.className).toContain('col-span-2');
  });

  it('plays one at a time: starting another stops the first', async () => {
    const user = userEvent.setup();
    renderRoute('/noticias?vista=shorts');
    const list = await shorts();

    await user.click(within(list).getByRole('button', { name: 'Reproducir Short 11' }));
    await user.click(within(list).getByRole('button', { name: 'Reproducir Short 13' }));

    const players = document.querySelectorAll('iframe');
    expect(players).toHaveLength(1);
    expect(players[0]).toHaveAttribute('title', 'Short 13');
    expect(within(list).getByRole('button', { name: 'Reproducir Short 11' })).toBeInTheDocument();
  });

  it('closes the player and goes back to the thumbnail', async () => {
    const user = userEvent.setup();
    renderRoute('/noticias?vista=shorts');
    const list = await shorts();
    await user.click(within(list).getByRole('button', { name: 'Reproducir Short 11' }));

    await user.click(within(list).getByRole('button', { name: 'Cerrar' }));

    expect(document.querySelector('iframe')).toBeNull();
    expect(within(list).getByRole('button', { name: 'Reproducir Short 11' })).toBeInTheDocument();
  });

  it('offers to open it on YouTube', async () => {
    const user = userEvent.setup();
    renderRoute('/noticias?vista=shorts');
    const list = await shorts();
    await user.click(within(list).getByRole('button', { name: 'Reproducir Short 11' }));

    const link = within(list).getByRole('link', { name: 'Abrir en YouTube' });
    expect(link).toHaveAttribute('href', 'https://www.youtube.com/shorts/short11');
    expect(link).toHaveAttribute('target', '_blank');
    expect(link).toHaveAttribute('rel', 'noopener noreferrer');
  });

  it('opens on YouTube a Short with no player address, instead of a dead button', async () => {
    api.news = [{ ...SHORTS[0]!, embedUrl: null }];
    renderRoute('/noticias?vista=shorts');
    const link = await screen.findByRole('link', { name: /Ver en Drafteados: Short 11/ });
    expect(link).toHaveAttribute('href', 'https://www.youtube.com/shorts/short11');
  });

  it('closes the player when switching to the news', async () => {
    const user = userEvent.setup();
    renderRoute('/noticias?vista=shorts');
    await user.click(within(await shorts()).getByRole('button', { name: 'Reproducir Short 11' }));
    await user.click(screen.getByRole('button', { name: 'Noticias' }));
    await screen.findByRole('article', { name: 'Lakers ganan en la prórroga' });
    expect(document.querySelector('iframe')).toBeNull();
  });
});

describe('Noticias · Shorts vacíos, errores y páginas', () => {
  it('says there are none yet', async () => {
    api.news = NEWS;
    renderRoute('/noticias?vista=shorts');
    expect(await screen.findByText(/Todavía no hay Shorts/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Ver todos los Shorts' })).not.toBeInTheDocument();
  });

  it('says there are none with a filter, and offers to see them all', async () => {
    const user = userEvent.setup();
    renderRoute('/noticias?vista=shorts&equipo=PHI');
    expect(await screen.findByText(/No hay Shorts con estos filtros/)).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Ver todos los Shorts' }));

    expect(await shorts()).toBeInTheDocument();
    expect(where()).toBe('/noticias?vista=shorts');
  });

  it('says so, with a way to retry, when the Shorts cannot be loaded', async () => {
    const user = userEvent.setup();
    api.news = 500;
    renderRoute('/noticias?vista=shorts');
    expect(await screen.findByText(/No se pudieron cargar los Shorts/)).toBeInTheDocument();

    api.news = [...NEWS, ...SHORTS];
    await user.click(screen.getByRole('button', { name: 'Reintentar' }));
    expect(await shorts()).toBeInTheDocument();
  });

  it('loads more Shorts when there are more', async () => {
    const user = userEvent.setup();
    api.newsPageSize = 2;
    renderRoute('/noticias?vista=shorts');
    const list = await shorts();
    expect(within(list).getAllByRole('listitem')).toHaveLength(2);

    await user.click(screen.getByRole('button', { name: 'Cargar más' }));

    await waitFor(() => expect(within(list).getAllByRole('listitem')).toHaveLength(3));
    expect(screen.queryByRole('button', { name: 'Cargar más' })).not.toBeInTheDocument();
  });

  it('does not talk about the translation credit in the Shorts', async () => {
    api.translationStatus = {
      enabled: true,
      used: 950_000,
      limit: 1_000_000,
      percent: 95,
      blocked: false,
    };
    renderRoute('/noticias?vista=shorts');
    await shorts();
    expect(screen.queryByText(/crédito de traducción/)).not.toBeInTheDocument();
  });
});
