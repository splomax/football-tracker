// Phone notifications (iPhone first). An iPhone only lets a website send notifications once it's added to the Home
// Screen (manifest.webmanifest) and opened from there, and they arrive through a service worker (sw.js) even when the
// app is closed. For now this just registers the service worker, on admin pages.

/** Register sw.js, once the admin features are on. Quietly does nothing where service workers aren't available. */
export async function registerServiceWorker() {
  if (!("serviceWorker" in navigator)) return null;
  try {
    return await navigator.serviceWorker.register("/sw.js");
  } catch (err) {
    console.error("service worker", err);
    return null;
  }
}
