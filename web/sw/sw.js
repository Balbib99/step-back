// step-back service worker. Two placeholders are filled in at build time by vite-plugin-sw.ts:
// the build id and the list of files that make up the app. In development there is no service
// worker (it is only registered by the built app).
//
// What it does, and why:
//  - The app shell (index.html, scripts, styles, fonts, icons) is stored when the worker installs,
//    so the app opens without a connection.
//  - A screen (a navigation) asks the network first and falls back to the stored shell.
//  - Data (/api) asks the network first and falls back to the last copy. This is deliberately not
//    "stale while revalidate": that would show a live score as it was a minute ago and the app
//    would not look again until its next refresh. Online you always see the latest.
//  - Pictures (/api/crests, news images, thumbnails) are kept once and reused: the server already
//    serves them as unchanging.
//  - /api/health is never stored: it is how the app finds out the server is down.
//  - Only successful answers are stored, so a login prompt or an error is never kept.
//
// A copy served from storage is marked, and carries the moment it was saved, so the app can say
// "sin conexión · actualizado hace 5 min".

const BUILD = '__BUILD__';
const PRECACHE = /*__PRECACHE__*/ [];

const SHELL_PREFIX = 'step-back-shell-';
const SHELL = `${SHELL_PREFIX}${BUILD}`;
const DATA = 'step-back-data-v1';
const PICTURES = 'step-back-pictures-v1';

/** After this long without an answer from the network, a stored copy is used instead. */
const DATA_TIMEOUT_MS = 4000;
const PAGE_TIMEOUT_MS = 3000;
const MAX_DATA_ENTRIES = 150;
const MAX_PICTURES = 100;

const SAVED_AT = 'x-step-back-saved-at';
const FROM_STORAGE = 'x-step-back-from-storage';

const PICTURE_PATH = /^\/api\/(crests\/[^/]+|news\/\d+\/image|highlights\/\d+\/thumb)$/;

/** A stored copy matches whatever `Vary` says: it was saved by this same browser. */
const MATCH = { ignoreVary: true };

class Timeout extends Error {}

/** Resolves with the promise, or rejects with Timeout when it takes longer than `ms`. */
function within(promise, ms) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Timeout()), ms);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error) => {
        clearTimeout(timer);
        reject(error);
      },
    );
  });
}

/** A copy of a response with the moment it was saved, ready to store. */
function stamp(response) {
  const headers = new Headers(response.headers);
  headers.set(SAVED_AT, String(Date.now()));
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

/** A stored response marked as such, so the app knows it is not live. */
function fromStorage(response) {
  const headers = new Headers(response.headers);
  headers.set(FROM_STORAGE, '1');
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

/** Keeps the newest `max` entries of a cache (it lists them oldest first). */
async function trim(cache, max) {
  const keys = await cache.keys();
  for (const key of keys.slice(0, Math.max(0, keys.length - max))) await cache.delete(key);
}

async function save(cache, request, response, max) {
  if (!response.ok) return;
  // Replacing an entry must put it last, so the oldest are the ones that go.
  await cache.delete(request);
  await cache.put(request, stamp(response));
  if (max) await trim(cache, max);
}

/**
 * Network first; when it is down, slow or answering with a server error, the last copy. A slow
 * request still finishes and refreshes the copy.
 */
async function networkFirst(event, request, cacheName, timeoutMs, max) {
  const cache = await caches.open(cacheName);
  let failure;
  const network = fetch(request).then(async (response) => {
    if (response.status >= 500) {
      failure = response; // with no copy to fall back on, this is still the honest answer
      throw new Error(`server error ${response.status}`);
    }
    // The copy is written while the page already uses the answer; the worker stays alive for it.
    event.waitUntil(save(cache, request, response.clone(), max));
    return response;
  });
  try {
    return await within(network, timeoutMs);
  } catch {
    const stored = await cache.match(request, MATCH);
    if (stored) {
      event.waitUntil(network.catch(() => undefined)); // let it finish and refresh the copy
      return fromStorage(stored);
    }
    if (failure) return failure;
    return network; // nothing saved: the real answer, or the real failure
  }
}

/** The stored copy if there is one, otherwise the network (and keep what it answers). */
async function cacheFirst(event, request, cacheName, max) {
  const cache = await caches.open(cacheName);
  const stored = await cache.match(request, MATCH);
  if (stored) return stored;
  const response = await fetch(request);
  event.waitUntil(save(cache, request, response.clone(), max));
  return response;
}

/** A screen: the network, and the stored shell when there is no network. */
async function navigate(event) {
  const cache = await caches.open(SHELL);
  try {
    const response = await within(fetch(event.request), PAGE_TIMEOUT_MS);
    // Keep the shell fresh: it is what opens the app next time there is no connection.
    if (response.ok) event.waitUntil(cache.put('/', response.clone()));
    return response;
  } catch (error) {
    const shell = await cache.match('/', MATCH);
    if (shell) return shell;
    throw error;
  }
}

function route(event) {
  const { request } = event;
  if (request.method !== 'GET') return undefined;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return undefined;

  if (url.pathname === '/api/health') return undefined; // never stored: it tells the app about the server
  if (PICTURE_PATH.test(url.pathname)) return cacheFirst(event, request, PICTURES, MAX_PICTURES);
  if (url.pathname.startsWith('/api/')) {
    return networkFirst(event, request, DATA, DATA_TIMEOUT_MS, MAX_DATA_ENTRIES);
  }
  if (request.mode === 'navigate') return navigate(event);
  if (PRECACHE.includes(url.pathname)) return cacheFirst(event, request, SHELL);
  return undefined;
}

self.addEventListener('install', (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(SHELL);
      await cache.addAll(PRECACHE);
      // The page that is open keeps working with the files it already has (they are all stored
      // under their own names), so the new worker can take over at once.
      await self.skipWaiting();
    })(),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      for (const name of await caches.keys()) {
        if (name.startsWith(SHELL_PREFIX) && name !== SHELL) await caches.delete(name);
      }
      await self.clients.claim();
    })(),
  );
});

self.addEventListener('fetch', (event) => {
  const answer = route(event);
  if (answer) event.respondWith(answer);
});

// Notifications (module push). The server sends { title, body, url, tag }; every push must show
// something (the browser withdraws the permission from a worker that stays silent), so a message
// that cannot be read still shows a generic one.
self.addEventListener('push', (event) => {
  let message = {};
  try {
    message = event.data ? event.data.json() : {};
  } catch {
    // Not JSON: the generic notification below.
  }
  const title = typeof message.title === 'string' && message.title ? message.title : 'step-back';
  event.waitUntil(
    self.registration.showNotification(title, {
      body: typeof message.body === 'string' ? message.body : '',
      // A newer notification about the same event replaces the old one instead of piling up.
      tag: typeof message.tag === 'string' ? message.tag : undefined,
      icon: '/icons/icon-192.png',
      data: { url: safeTarget(message.url) },
    }),
  );
});

/** Only a path of this app is opened, whatever the message says. */
function safeTarget(url) {
  return typeof url === 'string' && /^\/(?!\/)/.test(url) ? url : '/';
}

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const target = safeTarget(event.notification.data && event.notification.data.url);
  event.waitUntil(
    (async () => {
      const open = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
      // The app is already open: bring it to the game rather than opening a second one.
      for (const client of open) {
        if (new URL(client.url).origin !== self.location.origin) continue;
        await client.focus();
        if ('navigate' in client) {
          try {
            await client.navigate(target);
            return;
          } catch {
            // Some browsers refuse; open a window below.
          }
        }
        break;
      }
      await self.clients.openWindow(target);
    })(),
  );
});
