import { QueryClientProvider } from '@tanstack/react-query';
import { act, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { OfflineBanner } from '../components/OfflineBanner';
import { api, renderRoute, stubApi } from '../test-support';
import { noteResponse, offlineMessage, resetOfflineState, useOfflineState } from './offline';
import { createQueryClient } from './queries';

const NOW = new Date('2026-10-07T10:00:00Z');
const stored = (savedAt: number) =>
  new Headers({ 'x-step-back-from-storage': '1', 'x-step-back-saved-at': String(savedAt) });
const minutesAgo = (minutes: number) => NOW.getTime() - minutes * 60_000;

function setOnline(value: boolean) {
  Object.defineProperty(navigator, 'onLine', { configurable: true, get: () => value });
  window.dispatchEvent(new Event(value ? 'online' : 'offline'));
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date', 'setInterval', 'clearInterval'] });
  vi.setSystemTime(NOW);
  resetOfflineState();
});
afterEach(() => {
  vi.useRealTimers();
  resetOfflineState();
  Object.defineProperty(navigator, 'onLine', { configurable: true, get: () => true });
});

function Probe() {
  const state = useOfflineState();
  return <output>{JSON.stringify(state)}</output>;
}
const probed = () => JSON.parse(screen.getByRole('status').textContent!);

describe('noteResponse', () => {
  it('knows a copy from storage by the headers the service worker adds', () => {
    render(<Probe />);
    act(() => noteResponse(stored(minutesAgo(5))));
    expect(probed()).toEqual({ offline: true, savedAt: minutesAgo(5) });
  });

  it('keeps the oldest copy: the screen is only as fresh as its stalest part', () => {
    render(<Probe />);
    act(() => noteResponse(stored(minutesAgo(5))));
    act(() => noteResponse(stored(minutesAgo(90))));
    act(() => noteResponse(stored(minutesAgo(2))));
    expect(probed().savedAt).toBe(minutesAgo(90));
  });

  it('forgets them all when a live answer arrives: the connection is back', () => {
    render(<Probe />);
    act(() => noteResponse(stored(minutesAgo(5))));
    act(() => noteResponse(new Headers()));
    expect(probed()).toEqual({ offline: false, savedAt: null });
  });

  it('ignores a stored marker without a usable date', () => {
    render(<Probe />);
    act(() => noteResponse(new Headers({ 'x-step-back-from-storage': '1' })));
    act(() =>
      noteResponse(
        new Headers({ 'x-step-back-from-storage': '1', 'x-step-back-saved-at': 'yesterday' }),
      ),
    );
    expect(probed().offline).toBe(false);
  });
});

describe('the browser connection', () => {
  it('is offline when the browser says so, with nothing stored shown yet', () => {
    render(<Probe />);
    act(() => setOnline(false));
    expect(probed()).toEqual({ offline: true, savedAt: null });
    act(() => setOnline(true));
    expect(probed().offline).toBe(false);
  });
});

describe('offlineMessage', () => {
  it('says how old the stored data is', () => {
    expect(offlineMessage(minutesAgo(5), NOW, 'Europe/Madrid')).toBe(
      'Sin conexión · actualizado hace 5 min',
    );
    expect(offlineMessage(minutesAgo(180), NOW, 'Europe/Madrid')).toBe(
      'Sin conexión · actualizado hace 3 h',
    );
    expect(offlineMessage(minutesAgo(30 * 60), NOW, 'Europe/Madrid')).toBe(
      'Sin conexión · actualizado ayer',
    );
  });

  it('says only "Sin conexión" when no stored copy is on screen', () => {
    expect(offlineMessage(null, NOW, 'Europe/Madrid')).toBe('Sin conexión');
  });
});

describe('OfflineBanner', () => {
  const renderBanner = () =>
    render(
      <QueryClientProvider client={createQueryClient()}>
        <OfflineBanner />
      </QueryClientProvider>,
    );

  it('shows nothing while everything is live', () => {
    renderBanner();
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
  });

  it('says it is offline and how old the data is', () => {
    renderBanner();
    act(() => noteResponse(stored(minutesAgo(5))));
    expect(screen.getByRole('status')).toHaveTextContent('Sin conexión · actualizado hace 5 min');
  });

  it('keeps counting: five minutes later it says ten', () => {
    renderBanner();
    act(() => noteResponse(stored(minutesAgo(5))));
    act(() => void vi.advanceTimersByTime(5 * 60_000));
    expect(screen.getByRole('status')).toHaveTextContent('actualizado hace 10 min');
  });

  it('goes away when the connection comes back', () => {
    renderBanner();
    act(() => noteResponse(stored(minutesAgo(5))));
    act(() => noteResponse(new Headers()));
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
  });
});

describe('the app with no connection', () => {
  beforeEach(() => {
    vi.useRealTimers();
    stubApi();
  });
  afterEach(() => vi.unstubAllGlobals());

  it('still asks for its data, so the service worker can answer, instead of staying on the placeholder', async () => {
    setOnline(false);
    renderRoute('/clasificacion');
    // The default of the query library would pause every query offline and never get here.
    expect(await screen.findByRole('list', { name: /Clasificación del/ })).toBeInTheDocument();
  });

  it('says that what it shows is a stored copy, and stops saying it once data is live again', async () => {
    const live = globalThis.fetch;
    const savedAt = Date.now() - 5 * 60_000;
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string, init?: RequestInit) => {
        const response = await (live as typeof fetch)(url, init);
        const headers = new Headers(response.headers);
        headers.set('x-step-back-from-storage', '1');
        headers.set('x-step-back-saved-at', String(savedAt));
        return new Response(response.body, { status: response.status, headers });
      }),
    );
    renderRoute('/clasificacion');
    await screen.findByRole('list', { name: /Clasificación del/ });
    expect(await screen.findByText(/Sin conexión · actualizado hace 5 min/)).toBeInTheDocument();

    // The connection returns: the next answers are live and the band goes away.
    vi.stubGlobal('fetch', live);
    act(() => setOnline(true));
    await waitFor(() => expect(screen.queryByText(/Sin conexión/)).not.toBeInTheDocument());
  });

  it('looks again at once when the server answers its health check while copies are shown', async () => {
    const live = globalThis.fetch;
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string, init?: RequestInit) => {
        const response = await (live as typeof fetch)(url, init);
        if (url.includes('/api/health')) return response; // the server is up...
        const headers = new Headers(response.headers); // ...but these are stored copies
        headers.set('x-step-back-from-storage', '1');
        headers.set('x-step-back-saved-at', String(Date.now() - 60_000));
        return new Response(response.body, { status: response.status, headers });
      }),
    );
    renderRoute('/clasificacion');
    await screen.findByRole('list', { name: /Clasificación del/ });
    await waitFor(() =>
      expect(api.requests.filter((u) => u.startsWith('/api/standings')).length).toBeGreaterThan(1),
    );
  });
});
