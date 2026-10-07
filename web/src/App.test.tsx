import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AppRoutes } from './App';

const health = {
  status: 'ok',
  time: '2026-10-07T21:41:00.000Z', // 23:41 in Madrid (UTC+2)
  uptimeSeconds: 5,
  modules: [],
  jobs: [],
};
const config = {
  timeZone: 'Europe/Madrid',
  favoriteTeams: ['MIN', 'LAL', 'PHI'],
  features: { translation: false, push: false },
  vapidPublicKey: null,
  modules: [],
};

function stubApi(overrides: { health?: object | 'down'; config?: object | 'down' } = {}) {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) => {
      const body = url.includes('/api/health')
        ? (overrides.health ?? health)
        : url.includes('/api/teams')
          ? { teams: [] }
          : url.includes('/api/games')
            ? { games: [] }
            : (overrides.config ?? config);
      if (body === 'down') throw new TypeError('network down');
      return new Response(JSON.stringify(body), { status: 200 });
    }),
  );
}

function renderApp(path = '/') {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[path]}>
        <AppRoutes />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

beforeEach(() => stubApi());
afterEach(() => vi.unstubAllGlobals());

describe('navigation', () => {
  it('shows the five tabs of the bottom bar', () => {
    renderApp();
    const nav = screen.getByRole('navigation', { name: 'Principal' });
    const labels = within(nav)
      .getAllByRole('link')
      .map((link) => link.textContent);
    expect(labels).toEqual(['Hoy', 'Calendario', 'Clasificación', 'Noticias', 'Jugadas']);
  });

  it('marks the current tab and moves to another screen when it is tapped', async () => {
    renderApp();
    const nav = screen.getByRole('navigation', { name: 'Principal' });
    expect(within(nav).getByRole('link', { name: 'Hoy' })).toHaveAttribute('aria-current', 'page');

    await userEvent.click(within(nav).getByRole('link', { name: 'Noticias' }));

    expect(await screen.findByRole('heading', { level: 1, name: 'Noticias' })).toBeInTheDocument();
    expect(within(nav).getByRole('link', { name: 'Noticias' })).toHaveAttribute(
      'aria-current',
      'page',
    );
    expect(within(nav).getByRole('link', { name: 'Hoy' })).not.toHaveAttribute('aria-current');
    expect(document.title).toBe('Noticias · step-back');
  });

  it.each([
    ['/calendario', 'Calendario'],
    ['/clasificacion', 'Clasificación'],
    ['/jugadas', 'Jugadas'],
  ])('opens %s directly', (path, title) => {
    renderApp(path);
    expect(screen.getByRole('heading', { level: 1, name: title })).toBeInTheDocument();
  });

  it('tells the user when an address does not exist', () => {
    renderApp('/nope');
    expect(screen.getByRole('heading', { name: 'Página no encontrada' })).toBeInTheDocument();
  });
});

describe('freshness indicator', () => {
  it('shows when the data was last updated, in the configured time zone', async () => {
    renderApp();
    expect(await screen.findByText('Actualizado 23:41')).toBeInTheDocument();
  });

  it('warns when a source is failing but the server answers', async () => {
    stubApi({ health: { ...health, status: 'degraded' } });
    renderApp();
    expect(await screen.findByText('Alguna fuente falla')).toBeInTheDocument();
  });

  it('warns when the server cannot be reached', async () => {
    stubApi({ health: 'down' });
    renderApp();
    expect(await screen.findByText('Sin conexión con el servidor')).toBeInTheDocument();
  });
});

describe('Hoy', () => {
  it('shows the favourite teams from the server configuration, painted with their palette', async () => {
    renderApp();
    const list = await screen.findByRole('list', { name: 'Equipos favoritos' });
    const badges = within(list).getAllByText(/^(MIN|LAL|PHI)$/);
    expect(badges.map((badge) => badge.textContent)).toEqual(['MIN', 'LAL', 'PHI']);

    const minTag = list.querySelector<HTMLElement>('[data-team="MIN"]');
    expect(minTag?.style.getPropertyValue('--field')).toBe('#0C2340');
    expect(minTag?.style.getPropertyValue('--numeral')).toBe('#78BE20');
  });

  it('shows a placeholder, not an empty list, while the configuration loads', () => {
    renderApp();
    expect(screen.queryByRole('list', { name: 'Equipos favoritos' })).not.toBeInTheDocument();
  });

  it('explains what is missing when the configuration cannot be loaded', async () => {
    stubApi({ config: 'down' });
    renderApp();
    expect(await screen.findByText(/No se pudo cargar tu configuración/)).toBeInTheDocument();
  });
});
