// Where the page's games come from. Normally each league straight from ESPN (js/espn.js, in js/main.js); the admin's
// pages ask the program on Cloudflare instead (js/admin.js, worker/scorekeeper.js). If it fails, that update comes
// from ESPN.

let server = null;  // () => Promise<{ games: { cfb, nfl }, confNames }>, or null for ESPN
let last = null;    // where the last update came from: "server", "espn" (server not in use), "espn-fallback", or null
let poller = () => {};

export const useServer = (fetchGames) => { server = fetchGames; };
export const serverSource = () => server;
export const noteSource = (from) => { last = from; };
export const lastSource = () => last;
/** js/main.js's update-right-now, so an admin page switches to the server without waiting for the next update. */
export const setPoller = (fn) => { poller = fn; };
export const pollNow = () => poller();
