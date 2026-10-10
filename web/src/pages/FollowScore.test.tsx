import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { api, PUSH_CONFIG, renderRoute, stubApi, where } from '../test-support';

// The live score as one notification that updates in place: by itself for the games of a team that
// has it on, and from a button on the game screen for any other.

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-10-07T10:00:00Z'));
  stubApi();
  api.config = PUSH_CONFIG;
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

const button = (name: string | RegExp) => screen.findByRole('button', { name });

describe('Partido · marcador en el móvil, un partido que no es de tus equipos', () => {
  it('offers to follow it, and says what it is', async () => {
    renderRoute('/partido/other');
    const follow = await button('Seguir el marcador en el móvil');
    expect(follow).toHaveAttribute('aria-pressed', 'false');
    expect(screen.getByText(/única notificación que se actualiza con cada cambio/)).toBeVisible();
  });

  it('follows it with a press, and unfollows it with another', async () => {
    const user = userEvent.setup();
    renderRoute('/partido/other');

    await user.click(await button('Seguir el marcador en el móvil'));
    const unfollow = await button('Dejar de seguir el marcador');
    expect(unfollow).toHaveAttribute('aria-pressed', 'true');
    expect(api.pushFollows).toEqual(['other']);

    await user.click(unfollow);
    await button('Seguir el marcador en el móvil');
    expect(api.pushFollows).toEqual([]);
  });

  it('shows it as followed when the server already has it', async () => {
    api.pushFollows = ['other'];
    renderRoute('/partido/other');
    expect(await button('Dejar de seguir el marcador')).toHaveAttribute('aria-pressed', 'true');
  });

  it('goes back and says so when the change cannot be saved', async () => {
    const user = userEvent.setup();
    api.pushFollowStatus = 500;
    renderRoute('/partido/other');

    await user.click(await button('Seguir el marcador en el móvil'));

    expect(await screen.findByRole('alert')).toHaveTextContent('No se pudo guardar el cambio');
    await waitFor(() =>
      expect(
        screen.getByRole('button', { name: 'Seguir el marcador en el móvil' }),
      ).toHaveAttribute('aria-pressed', 'false'),
    );
  });

  it('reminds that the notifications of this device must be on, and where', async () => {
    renderRoute('/partido/other');
    await button('Seguir el marcador en el móvil');
    // The test browser has no notifications: the same state as a phone that has not been asked.
    expect(screen.getByText(/activa antes las notificaciones de este dispositivo/)).toBeVisible();
    expect(screen.getByRole('link', { name: 'Ajustes' })).toHaveAttribute('href', '/ajustes');
  });
});

describe('Partido · marcador en el móvil, un partido de tus equipos', () => {
  it('says it arrives by itself, instead of offering a button', async () => {
    renderRoute('/partido/live'); // PHI is a favourite and has the live score on
    expect(await screen.findByText(/te llegará solo al móvil/)).toBeVisible();
    expect(
      screen.queryByRole('button', { name: /Seguir el marcador en el móvil/ }),
    ).not.toBeInTheDocument();
  });

  it('leads to the settings, where it can be turned off', async () => {
    const user = userEvent.setup();
    renderRoute('/partido/live');
    await user.click(await screen.findByRole('link', { name: 'Cambiarlo en Ajustes' }));
    expect(where()).toBe('/ajustes');
  });

  it('offers the button again once the team has it off', async () => {
    api.pushSettings = api.pushSettings.map((t) => (t.team === 'PHI' ? { ...t, live: false } : t));
    renderRoute('/partido/live');
    expect(await button('Seguir el marcador en el móvil')).toBeVisible();
  });
});

describe('Partido · cuándo no aparece', () => {
  it('is not there for a finished game', async () => {
    renderRoute('/partido/final');
    await screen.findByRole('article', { name: /Minnesota Timberwolves 104/ });
    expect(screen.queryByRole('region', { name: 'Marcador en el móvil' })).not.toBeInTheDocument();
  });

  it('is not there when the server has no notifications', async () => {
    api.config = { ...PUSH_CONFIG, features: { translation: false, push: false } };
    renderRoute('/partido/other');
    await screen.findByRole('article', { name: /Denver Nuggets/ });
    expect(screen.queryByRole('region', { name: 'Marcador en el móvil' })).not.toBeInTheDocument();
  });
});

describe('Ajustes · marcador en vivo', () => {
  it('is on for each favourite, and can be turned off', async () => {
    const user = userEvent.setup();
    renderRoute('/ajustes');

    const box = await screen.findByRole('checkbox', {
      name: 'Marcador en vivo de Minnesota Timberwolves',
    });
    expect(box).toBeChecked();

    await user.click(box);
    await waitFor(() => expect(api.pushSettings.find((t) => t.team === 'MIN')?.live).toBe(false));
    expect(box).not.toBeChecked();
    expect(api.pushSettings.find((t) => t.team === 'LAL')?.live).toBe(true); // the others stay
  });

  it('is not a setting of the other teams: their games are followed one by one', async () => {
    renderRoute('/ajustes');
    await screen.findByRole('checkbox', { name: 'Marcador en vivo de Los Angeles Lakers' });
    expect(
      screen.queryByRole('checkbox', { name: /Marcador en vivo de Boston Celtics/ }),
    ).not.toBeInTheDocument();
    expect(screen.getByText(/Para seguir el marcador de un partido concreto/)).toBeInTheDocument();
  });
});
