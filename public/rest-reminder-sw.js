/**
 * Notification worker for the Rest Reminder tool.
 *
 * It exists for two reasons, and does nothing else:
 *
 * 1. Android Chrome throws `TypeError: Illegal constructor` for
 *    `new Notification()`; `registration.showNotification()` is the only path
 *    that works there.
 * 2. Clicking a banner should raise the tab that is already running the timer
 *    rather than opening a second copy of the page.
 *
 * There is deliberately no `fetch` handler. A service worker without one is
 * bypassed for network requests, so this cannot cache or stale-serve the site.
 */

self.addEventListener('install', () => {
  // Take over immediately; there is no cache to migrate.
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();

  const target = (event.notification.data && event.notification.data.url) || '/';

  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clientList) => {
      for (const client of clientList) {
        if (client.url.includes('/tools/rest-reminder') && 'focus' in client) {
          return client.focus();
        }
      }
      if (self.clients.openWindow) return self.clients.openWindow(target);
      return undefined;
    }),
  );
});
