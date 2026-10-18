// Game Tracker's service worker: the small script a browser keeps around to receive notifications while the site
// isn't open (iPhone notifications need the site added to the Home Screen, and this). Registered by js/push.js on
// admin pages. For now it only installs itself; receiving and showing notifications comes next.

self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (event) => event.waitUntil(self.clients.claim()));
