// Entry point: wires the modules together and polls ESPN.

import { LINKED_GAMES, LOADING, MOBILE_QUERY, POLL_MS } from "./config.js";
import { state, allGames } from "./state.js";
import { fetchGames } from "./espn.js";
import { checkRecaps } from "./recap.js";
import { renderList, listIsStale, initPicker } from "./picker.js";
import { renderBoard, highlightCard, initBoard, animateBoardLayout } from "./board.js";
import { setPicker, initDrawer } from "./drawer.js";
import { initSettings } from "./settings.js";
import { initTheme } from "./theme.js";
import { initView } from "./view.js";
import { countVisit } from "./counter.js";
import { loadAdmin, adminPolled } from "./admin.js";
import { initLogo } from "./logo.js";

let lastUpdated = null;
let linkPending = LINKED_GAMES.length > 0;  // a shared game link's card still needs its highlight once it first shows

async function poll() {
  if (LOADING) return;
  await Promise.all(Object.keys(state.games).map(async (league) => {
    try {
      const games = await fetchGames(league);
      // ESPN now and then answers with an empty week for a moment. Games don't vanish mid-week, so treat that as a
      // failed poll and keep what's showing rather than blanking the list and the board.
      if (!games.length && state.games[league].length) throw new Error("ESPN sent no games; keeping the last ones");
      state.games[league] = games;
      state.loaded[league] = true;
      lastUpdated = Date.now();
    } catch (err) {
      console.error(league, err);
    }
  }));
  renderUpdated();
  // First load renders right away; after that the list waits out LIST_REFRESH_MS so it doesn't shift under your finger.
  if (listIsStale()) renderList();
  renderBoard();
  adminPolled(allGames());
  const linked = linkPending && LINKED_GAMES.find((k) => document.querySelector(`.card[data-key="${k}"]`));
  if (linked) { linkPending = false; highlightCard(linked); }
  if (await checkRecaps(allGames().filter((g) => state.selected.has(g.key)))) renderBoard();
}

function renderUpdated() {
  if (lastUpdated === null) return;
  // No locale or timeZone passed, so the browser formats it in the viewer's own time zone.
  document.getElementById("updated").textContent =
    "Games updated at " + new Date(lastUpdated).toLocaleTimeString([], { hour: "numeric", minute: "2-digit", second: "2-digit" });
}


initPicker({
  onSelectionChanged: renderBoard,  // the picker already re-rendered (and animated) its own list
  onHighlight: (key) => {
    if (matchMedia(MOBILE_QUERY).matches) setPicker(false);  // close the drawer so the card is visible
    highlightCard(key);
  },
});
initBoard({
  onSelectionChanged: () => { renderList(); renderBoard(); },  // a card's ✕ unpicks, so uncheck its row too
});
initDrawer({ animateLayout: animateBoardLayout });
initSettings();
initLogo();
initTheme({ onChange: () => { renderList(); renderBoard(); } });  // logos differ per theme
initView({ onChange: renderBoard });

// Poll now and every POLL_MS after. Background tabs get their timers slowed down by the browser, so coming
// back to the tab fetches right away and restarts the timer from there.
let pollTimer;
function pollNow() {
  poll();
  clearInterval(pollTimer);
  pollTimer = setInterval(poll, POLL_MS);
}
pollNow();
document.addEventListener("visibilitychange", () => { if (!document.hidden) pollNow(); });

// The page loads behind the admin login; once the admin's features arrive, redraw the cards with them.
const isAdmin = await loadAdmin();  // logged in; the features are on only with ?admin
if (isAdmin && lastUpdated !== null) { renderList(); renderBoard(); }
if (!LOADING && !isAdmin) countVisit();
