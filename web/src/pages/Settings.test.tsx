import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { urlBase64ToBytes } from '../lib/push';
import { api, PUSH_CONFIG, renderRoute, stubApi } from '../test-support';

// A browser that can do push: a service worker with a push manager, and Notification.
const ENDPOINT = 'https://push.example/phone';

function fakeSubscription(key?: Uint8Array) {
  return {
    endpoint: ENDPOINT,
    options: { applicationServerKey: key ? key.buffer : null },
    toJSON: () => ({ endpoint: ENDPOINT, keys: { p256dh: 'p', auth: 'a' } }),
    unsubscribe: vi.fn(async () => true),
  };
}

function installBrowser(
  options: {
    permission?: NotificationPermission;
    existing?: boolean;
    answer?: NotificationPermission;
  } = {},
) {
  const { permission = 'default', existing = false, answer = 'granted' } = options;
  const subscription = fakeSubscription(urlBase64ToBytes(PUSH_CONFIG.vapidPublicKey));
  let current: ReturnType<typeof fakeSubscription> | null = existing ? subscription : null;
  const pushManager = {
    getSubscription: vi.fn(async () => current),
    subscribe: vi.fn(async () => (current = subscription)),
  };
  Object.defineProperty(navigator, 'serviceWorker', {
    configurable: true,
    value: { getRegistration: vi.fn(async () => ({ pushManager })) },
  });
  vi.stubGlobal('PushManager', class {});
  const notification = {
    permission,
    requestPermission: vi.fn(async () => {
      notification.permission = answer;
      return answer;
    }),
  };
  vi.stubGlobal('Notification', notification);
  return { pushManager, notification, subscription };
}

beforeEach(() => {
  stubApi();
  api.config = PUSH_CONFIG;
});
afterEach(() => {
  vi.unstubAllGlobals();
  Reflect.deleteProperty(navigator, 'serviceWorker');
});

describe('Ajustes: este dispositivo', () => {
  it('says so when the server has notifications off', async () => {
    api.config = {
      ...PUSH_CONFIG,
      features: { translation: false, push: false },
      vapidPublicKey: null,
    };
    installBrowser();
    renderRoute('/ajustes');
    expect(await screen.findByText(/no están activadas en el servidor/)).toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: 'Activar notificaciones' }),
    ).not.toBeInTheDocument();
  });

  it('explains when the browser cannot do notifications', async () => {
    renderRoute('/ajustes');
    expect(await screen.findByText(/no admite notificaciones/)).toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: 'Activar notificaciones' }),
    ).not.toBeInTheDocument();
  });

  it('does not ask for permission just by opening the screen', async () => {
    const { notification, pushManager } = installBrowser();
    renderRoute('/ajustes');
    await screen.findByRole('button', { name: 'Activar notificaciones' });
    expect(notification.requestPermission).not.toHaveBeenCalled();
    expect(pushManager.subscribe).not.toHaveBeenCalled();
  });

  it('asks only when the button is pressed, then subscribes and tells the server', async () => {
    const user = userEvent.setup();
    const { notification, pushManager } = installBrowser();
    renderRoute('/ajustes');

    await user.click(await screen.findByRole('button', { name: 'Activar notificaciones' }));

    await screen.findByText(/están activadas en este dispositivo/);
    expect(notification.requestPermission).toHaveBeenCalledTimes(1);
    expect(pushManager.subscribe).toHaveBeenCalledWith({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToBytes(PUSH_CONFIG.vapidPublicKey),
    });
    expect(api.pushSubscriptions).toEqual([
      `POST ${JSON.stringify({ endpoint: ENDPOINT, keys: { p256dh: 'p', auth: 'a' } })}`,
    ]);
  });

  it('subscribes to nothing when the permission is refused in the prompt', async () => {
    const user = userEvent.setup();
    const { pushManager } = installBrowser({ answer: 'denied' });
    renderRoute('/ajustes');

    await user.click(await screen.findByRole('button', { name: 'Activar notificaciones' }));

    await screen.findByText(/Has bloqueado las notificaciones/);
    expect(pushManager.subscribe).not.toHaveBeenCalled();
    expect(api.pushSubscriptions).toEqual([]);
  });

  it('shows how to unblock when they were already blocked', async () => {
    installBrowser({ permission: 'denied' });
    renderRoute('/ajustes');
    expect(await screen.findByText(/Has bloqueado las notificaciones/)).toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: 'Activar notificaciones' }),
    ).not.toBeInTheDocument();
  });

  it('reports a failure to subscribe and lets the user try again', async () => {
    const user = userEvent.setup();
    const { pushManager } = installBrowser();
    pushManager.subscribe.mockRejectedValueOnce(new Error('push service down'));
    renderRoute('/ajustes');

    await user.click(await screen.findByRole('button', { name: 'Activar notificaciones' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('No se pudieron activar');
    expect(screen.getByRole('button', { name: 'Activar notificaciones' })).toBeEnabled();
  });

  it('shows a browser that is already subscribed as active and refreshes it on the server', async () => {
    installBrowser({ permission: 'granted', existing: true });
    renderRoute('/ajustes');
    await screen.findByText(/están activadas en este dispositivo/);
    await waitFor(() => expect(api.pushSubscriptions).toHaveLength(1));
    expect(api.pushSubscriptions[0]).toMatch(/^POST /);
  });

  it('turns notifications off: tells the server and drops the subscription', async () => {
    const user = userEvent.setup();
    const { subscription } = installBrowser({ permission: 'granted', existing: true });
    renderRoute('/ajustes');

    await user.click(await screen.findByRole('button', { name: 'Desactivar en este dispositivo' }));

    await screen.findByRole('button', { name: 'Activar notificaciones' });
    expect(subscription.unsubscribe).toHaveBeenCalled();
    expect(api.pushSubscriptions.at(-1)).toBe(`DELETE ${JSON.stringify({ endpoint: ENDPOINT })}`);
  });

  it('starts again when the subscription was made for other server keys', async () => {
    const user = userEvent.setup();
    const { pushManager, subscription } = installBrowser({
      permission: 'default',
      existing: false,
    });
    const old = fakeSubscription(new Uint8Array([1, 2, 3]));
    pushManager.getSubscription.mockResolvedValueOnce(null); // the screen's own look-up
    pushManager.getSubscription.mockResolvedValueOnce(old); // when enabling
    renderRoute('/ajustes');

    await user.click(await screen.findByRole('button', { name: 'Activar notificaciones' }));

    await screen.findByText(/están activadas en este dispositivo/);
    expect(old.unsubscribe).toHaveBeenCalled();
    expect(pushManager.subscribe).toHaveBeenCalled();
    expect(subscription.unsubscribe).not.toHaveBeenCalled();
  });
});

describe('Ajustes: notificación de prueba', () => {
  it('sends a test to this device and says it went', async () => {
    const user = userEvent.setup();
    installBrowser({ permission: 'granted', existing: true });
    renderRoute('/ajustes');

    await user.click(await screen.findByRole('button', { name: 'Enviar notificación de prueba' }));

    await screen.findByText('Enviada. Debería llegar en unos segundos.');
    expect(api.pushSubscriptions.at(-1)).toBe(`POST ${JSON.stringify({ endpoint: ENDPOINT })}`);
  });

  it('tells what the server said when the test fails', async () => {
    const user = userEvent.setup();
    installBrowser({ permission: 'granted', existing: true });
    api.pushTestStatus = 502;
    renderRoute('/ajustes');

    await user.click(await screen.findByRole('button', { name: 'Enviar notificación de prueba' }));

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'El servicio de notificaciones no respondió',
    );
  });

  it('is not offered before notifications are on', async () => {
    installBrowser();
    renderRoute('/ajustes');
    await screen.findByRole('button', { name: 'Activar notificaciones' });
    expect(screen.queryByRole('button', { name: 'Enviar notificación de prueba' })).toBeNull();
  });
});

describe('Ajustes: qué avisar', () => {
  it('lists the three favourites with their current settings', async () => {
    installBrowser();
    renderRoute('/ajustes');

    expect(
      await screen.findByRole('checkbox', { name: 'Inicio del partido de Minnesota Timberwolves' }),
    ).toBeChecked();
    expect(
      screen.getByRole('checkbox', { name: 'Resultado final de Los Angeles Lakers' }),
    ).toBeChecked();
    expect(
      screen.getByRole('combobox', { name: 'Recordatorio de Philadelphia 76ers' }),
    ).toHaveValue('30');
  });

  it('saves a team that is turned off, and only that one', async () => {
    const user = userEvent.setup();
    installBrowser();
    renderRoute('/ajustes');

    const box = await screen.findByRole('checkbox', {
      name: 'Inicio del partido de Los Angeles Lakers',
    });
    await user.click(box);

    expect(box).not.toBeChecked();
    await waitFor(() =>
      expect(api.pushSettings.find((t) => t.team === 'LAL')).toEqual({
        team: 'LAL',
        start: false,
        end: true,
        reminderMinutes: 30,
        news: false,
      }),
    );
    expect(api.pushSettings.find((t) => t.team === 'MIN')?.start).toBe(true);
  });

  it('changes the reminder', async () => {
    const user = userEvent.setup();
    installBrowser();
    renderRoute('/ajustes');

    const select = await screen.findByRole('combobox', {
      name: 'Recordatorio de Minnesota Timberwolves',
    });
    await user.selectOptions(select, 'Sin aviso previo');

    await waitFor(() =>
      expect(api.pushSettings.find((t) => t.team === 'MIN')?.reminderMinutes).toBe(0),
    );
  });

  it('goes back to the previous value and says so when saving fails', async () => {
    const user = userEvent.setup();
    installBrowser();
    renderRoute('/ajustes');
    const box = await screen.findByRole('checkbox', {
      name: 'Resultado final de Minnesota Timberwolves',
    });
    api.pushSaveStatus = 500;

    await user.click(box);

    expect(await screen.findByRole('alert')).toHaveTextContent('No se pudo guardar');
    await waitFor(() => expect(box).toBeChecked());
  });
});

describe('Ajustes: noticias y otros equipos', () => {
  it('turns featured news on for a favourite, off by default', async () => {
    const user = userEvent.setup();
    installBrowser();
    renderRoute('/ajustes');

    const box = await screen.findByRole('checkbox', {
      name: 'Noticias destacadas de Minnesota Timberwolves',
    });
    expect(box).not.toBeChecked();
    await user.click(box);

    await waitFor(() => expect(api.pushSettings.find((t) => t.team === 'MIN')?.news).toBe(true));
  });

  it('offers featured news only for favourites', async () => {
    const user = userEvent.setup();
    installBrowser();
    renderRoute('/ajustes');
    await user.click(await screen.findByText(/Otros equipos/));

    expect(
      screen.queryByRole('checkbox', { name: 'Noticias destacadas de Boston Celtics' }),
    ).toBeNull();
    expect(
      screen.getByRole('checkbox', { name: 'Inicio del partido de Boston Celtics' }),
    ).toBeInTheDocument();
  });

  it('starts with the other teams off and turns one on', async () => {
    const user = userEvent.setup();
    installBrowser();
    renderRoute('/ajustes');
    await user.click(await screen.findByText(/Otros equipos/));

    const start = screen.getByRole('checkbox', { name: 'Inicio del partido de Denver Nuggets' });
    expect(start).not.toBeChecked();
    await user.click(start);

    await waitFor(() => expect(api.pushSettings.find((t) => t.team === 'DEN')?.start).toBe(true));
    expect(api.pushSettings.find((t) => t.team === 'BOS')?.start).toBe(false);
    expect(screen.getByText(/1 con avisos/)).toBeInTheDocument();
  });

  it('turns every other team on or off at once, and leaves the favourites alone', async () => {
    const user = userEvent.setup();
    installBrowser();
    renderRoute('/ajustes');
    await user.click(await screen.findByText(/Otros equipos/));

    await user.click(screen.getByRole('button', { name: 'Activar todos' }));
    await waitFor(() =>
      expect(
        api.pushSettings
          .filter((t) => ['BOS', 'DEN'].includes(t.team))
          .every((t) => t.start && t.end),
      ).toBe(true),
    );
    expect(api.pushSettings.find((t) => t.team === 'MIN')?.reminderMinutes).toBe(30);

    await user.click(screen.getByRole('button', { name: 'Quitar todos' }));
    await waitFor(() =>
      expect(
        api.pushSettings.filter((t) => ['BOS', 'DEN'].includes(t.team)).some((t) => t.start),
      ).toBe(false),
    );
  });
});

describe('the way in', () => {
  it('is a bell in the top bar', async () => {
    const user = userEvent.setup();
    installBrowser();
    renderRoute('/');
    await user.click(await screen.findByRole('link', { name: 'Ajustes y notificaciones' }));
    expect(await screen.findByRole('heading', { name: 'Ajustes' })).toBeInTheDocument();
  });
});
