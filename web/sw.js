// WHALESHIP service worker: Web Push notifications only. It caches nothing on purpose, so it can never pin an old
// version of the game. Scope: the game's own folder.
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', e => e.waitUntil(self.clients.claim()));

self.addEventListener('push', e => {
  let d = {};
  try { d = e.data ? e.data.json() : {}; } catch { d = {title: 'WHALESHIP', body: e.data ? e.data.text() : ''}; }
  e.waitUntil((async () => {
    // already looking at that game in a focused window? the page has its own cues — don't double up
    const wins = await self.clients.matchAll({type: 'window', includeUncontrolled: true});
    if (d.match && wins.some(w => w.focused && w.visibilityState === 'visible' && w.url.includes(d.match))) return;
    await self.registration.showNotification(d.title || 'WHALESHIP', {
      body: d.body || '', tag: d.tag || 'whaleship', renotify: true,
      icon: new URL('icons/icon-192.png', self.registration.scope).href, badge: new URL('icons/badge-72.png', self.registration.scope).href,
      data: {url: new URL(d.url || './', self.registration.scope).href, match: d.match || ''},
    });
  })());
});

self.addEventListener('notificationclick', e => {
  e.notification.close();
  const {url, match} = e.notification.data || {};
  e.waitUntil((async () => {
    const wins = await self.clients.matchAll({type: 'window', includeUncontrolled: true});
    const mine = wins.find(w => w.url.startsWith(self.registration.scope)) || wins.find(w => /whaleship/.test(w.url));
    if (mine) { await mine.focus(); mine.postMessage({type: 'open-match', match, url}); return; }
    await self.clients.openWindow(url || self.registration.scope);
  })());
});
