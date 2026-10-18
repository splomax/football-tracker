// Game Tracker's service worker: the small script a phone keeps around to receive notifications while the app isn't
// open (iPhone notifications need the site added to the Home Screen, and this). Registered by js/push.js on admin
// pages. The server (worker/phones.js) pushes { title, body, key, icon }; this shows it (with the scoring team's logo
// for a score, else the football), and tapping it opens the app.

self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (event) => event.waitUntil(self.clients.claim()));

// Every push must show a notification (iPhones stop delivering to sites that don't).
self.addEventListener("push", (event) => {
  let message = {};
  try { message = event.data?.json() ?? {}; } catch {}
  event.waitUntil(self.registration.showNotification(message.title || "Game Tracker", {
    body: message.body || "",
    icon: message.icon || "/images/notification-icon.png",
    tag: message.key ? `${message.key}:${Date.now()}` : undefined,
    data: { key: message.key },
  }));
});

// Tapping one brings the app forward (or opens it) in admin mode.
self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  event.waitUntil((async () => {
    const open = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
    if (open.length) return open[0].focus();
    return self.clients.openWindow("/?admin");
  })());
});
