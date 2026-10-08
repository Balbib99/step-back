import { pushAckSchema, pushTestAckSchema } from '@step-back/shared';
import { useCallback, useEffect, useState } from 'react';
import { ApiError, sendJson } from './api';

/**
 * What this browser can do about notifications.
 * `unsupported`: no service worker, push or Notification (a browser tab on iOS, an old browser).
 */
export type PushPermission = 'unsupported' | NotificationPermission;

export function pushPermission(): PushPermission {
  if (
    typeof navigator === 'undefined' ||
    !('serviceWorker' in navigator) ||
    !('PushManager' in window) ||
    !('Notification' in window)
  ) {
    return 'unsupported';
  }
  return Notification.permission;
}

/** The key the server gives in base64url, as the bytes the push API wants. */
export function urlBase64ToBytes(value: string): Uint8Array<ArrayBuffer> {
  const padded = value + '='.repeat((4 - (value.length % 4)) % 4);
  const raw = atob(padded.replace(/-/g, '+').replace(/_/g, '/'));
  const bytes = new Uint8Array(new ArrayBuffer(raw.length));
  for (let i = 0; i < raw.length; i++) bytes[i] = raw.charCodeAt(i);
  return bytes;
}

const sameBytes = (a: ArrayBuffer | null, b: Uint8Array) =>
  a !== null && a.byteLength === b.length && new Uint8Array(a).every((byte, i) => byte === b[i]);

/** The worker that shows notifications. Not there in development, where nothing registers one. */
async function registration(): Promise<ServiceWorkerRegistration | undefined> {
  return navigator.serviceWorker.getRegistration();
}

async function currentSubscription(): Promise<PushSubscription | null> {
  const worker = await registration();
  return worker ? worker.pushManager.getSubscription() : null;
}

/** Tells the server about this browser. Safe to repeat. */
function tellServer(subscription: PushSubscription): Promise<unknown> {
  return sendJson('POST', '/api/push/subscribe', subscription.toJSON(), pushAckSchema);
}

export interface DevicePush {
  permission: PushPermission;
  /** Null while it is being looked up. */
  subscribed: boolean | null;
  busy: boolean;
  /** Spanish text of what went wrong the last time, if anything. */
  error: string | undefined;
  /** Asks for permission (only called from a press) and subscribes this browser. */
  enable: () => Promise<void>;
  disable: () => Promise<void>;
  /** Sends a test notification to this device; the result says what to tell the user. */
  test: () => Promise<{ ok: boolean; message: string }>;
}

/** Notifications on this device: permission, subscription, and turning them on or off. */
export function useDevicePush(publicKey: string | null): DevicePush {
  const [permission, setPermission] = useState<PushPermission>(pushPermission);
  const [subscribed, setSubscribed] = useState<boolean | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();

  // Once, when the screen opens: is this browser already subscribed?
  useEffect(() => {
    const initial = pushPermission();
    if (initial === 'unsupported') return;
    let live = true;
    currentSubscription().then(
      (subscription) => {
        if (!live) return;
        setSubscribed(subscription !== null);
        // The server may have dropped it (it was refused once): saying it again is free.
        if (subscription && initial === 'granted') void tellServer(subscription).catch(() => {});
      },
      () => live && setSubscribed(false),
    );
    return () => {
      live = false;
    };
  }, []);

  const enable = useCallback(async () => {
    if (!publicKey) return;
    setBusy(true);
    setError(undefined);
    try {
      const granted = await Notification.requestPermission();
      setPermission(granted);
      if (granted !== 'granted') return;

      const worker = await registration();
      if (!worker) throw new Error('La aplicación aún no está lista. Vuelve a intentarlo.');
      const key = urlBase64ToBytes(publicKey);
      let subscription = await worker.pushManager.getSubscription();
      // A subscription made for other server keys can never receive: start again.
      if (subscription && !sameBytes(subscription.options.applicationServerKey, key)) {
        await subscription.unsubscribe();
        subscription = null;
      }
      subscription ??= await worker.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: key,
      });
      await tellServer(subscription);
      setSubscribed(true);
    } catch (failure) {
      setError(
        failure instanceof Error && failure.message.startsWith('La aplicación')
          ? failure.message
          : 'No se pudieron activar las notificaciones. Inténtalo de nuevo.',
      );
    } finally {
      setBusy(false);
    }
  }, [publicKey]);

  const disable = useCallback(async () => {
    setBusy(true);
    setError(undefined);
    try {
      const subscription = await currentSubscription();
      if (subscription) {
        await sendJson(
          'DELETE',
          '/api/push/subscribe',
          { endpoint: subscription.endpoint },
          pushAckSchema,
        );
        await subscription.unsubscribe();
      }
      setSubscribed(false);
    } catch {
      setError('No se pudieron desactivar las notificaciones. Inténtalo de nuevo.');
    } finally {
      setBusy(false);
    }
  }, []);

  const test = useCallback(async () => {
    try {
      const subscription = await currentSubscription();
      if (!subscription) throw new Error('no subscription');
      await sendJson(
        'POST',
        '/api/push/test',
        { endpoint: subscription.endpoint },
        pushTestAckSchema,
      );
      return { ok: true, message: 'Enviada. Debería llegar en unos segundos.' };
    } catch (failure) {
      return {
        ok: false,
        message:
          failure instanceof ApiError && failure.detail
            ? failure.detail
            : 'No se pudo enviar la prueba. Inténtalo de nuevo.',
      };
    }
  }, []);

  return { permission, subscribed, busy, error, enable, disable, test };
}
