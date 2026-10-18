// State shared by the picker and the board. Viewer preferences are restored from localStorage.

import { store } from "./store.js";
import { LEAGUE_PARAM, LINKED_GAMES } from "./config.js";

// Declared before anything below saves picks (a ?game= link does, while this module loads).
let selectionSaved = () => {};  // the admin's notifications, which drop the bells of games no longer picked (js/admin.js)
export const onSelectionSaved = (fn) => { selectionSaved = fn; };

export const state = {
  games: { nfl: [], cfb: [] },                             // latest parsed games per league
  loaded: { nfl: false, cfb: false },                      // whether ESPN has answered for the league yet
  selected: new Set(store.get("selected", [])),            // picked game keys, "league:eventId"
  // Picker tab: cfb or nfl. Anything else saved (e.g. an old "all") falls back to College.
  tab: ["cfb", "nfl"].includes(store.get("tab")) ? store.get("tab") : "cfb",
  filters: loadFilters(),                                  // per league: { cfb: { confs, top25 }, nfl: { confs } }
  collapsedGroups: new Set(store.get("collapsedGroups", [])), // picker sections the viewer has minimized
};

// A ?league= link overrides the saved picker tab and becomes the new saved choice.
if (LEAGUE_PARAM) {
  state.tab = LEAGUE_PARAM;
  store.set("tab", LEAGUE_PARAM);
}

// A ?game= link adds its games to the viewer's own picks rather than replacing them. The param then comes out of
// the address bar, so a refresh or bookmark doesn't bring back a game the viewer has since removed.
if (LINKED_GAMES.length) {
  LINKED_GAMES.forEach((k) => state.selected.add(k));
  saveSelected();
  const url = new URL(location.href);
  url.searchParams.delete("game");
  history.replaceState(null, "", url);
}

// Saved filters have had two older shapes: college-only { conf, top25 }, then per league with a single conf.
// Carry either over to today's per-league { confs: [...] }.
function loadFilters() {
  const saved = store.get("filters", {});
  const collegeOnly = "conf" in saved || "top25" in saved;
  const confs = (f = {}) => f.confs ?? (f.conf ? [f.conf] : []);
  const cfb = collegeOnly ? saved : saved.cfb;
  return {
    cfb: { confs: confs(cfb), top25: !!cfb?.top25 },
    nfl: { confs: confs(saved.nfl) },
  };
}

export function saveSelected() {
  store.set("selected", [...state.selected]);
  selectionSaved();
}

export const allGames = () => [...state.games.cfb, ...state.games.nfl];

