// Where the page's games come from. Normally each league straight from ESPN (js/espn.js, in js/main.js); the admin's
// pages use the backend's feed instead (js/admin.js, worker/hub.js), which also brings their notifications. If the feed
// fails, that poll falls back to ESPN.

let backend = null;   // () => Promise<{ games: { cfb, nfl }, confNames }>, or null for ESPN
let poller = () => {};

export const useBackend = (feed) => { backend = feed; };
export const backendFeed = () => backend;
/** js/main.js's poll-right-now, for the admin's test button. */
export const setPoller = (fn) => { poller = fn; };
export const pollNow = () => poller();
