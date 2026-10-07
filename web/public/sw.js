// A deliberately empty service worker. Android only offers "Install app" for a page that has
// one, and for now that is all it is for: it caches nothing and answers nothing itself, every
// request goes to the network as usual. T25 replaces it with the real one (offline support).
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()));
self.addEventListener('fetch', () => {});
