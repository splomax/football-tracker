// App-wide constants.

export const LEAGUES = {
  nfl: "https://site.api.espn.com/apis/site/v2/sports/football/nfl/scoreboard",
  cfb: "https://site.api.espn.com/apis/site/v2/sports/football/college-football/scoreboard?groups=80&limit=300",
};

export const POLL_MS = 10000;
export const LIST_REFRESH_MS = 30000;  // the picker list refreshes less often than the board so it doesn't shift under your finger
export const GLOW_MS = 2400;           // matches the redzone-glow animation length (css/board.css)
export const RECAP_CHECK_MS = 2 * 60_000;     // how often a final game without a recap is checked again (js/recap.js)
export const RECAP_GIVE_UP_MS = 60 * 60_000;  // stop checking after an hour
export const FLASH_MS = 1600;          // matches the card-flash animation length (css/board.css)
export const MOBILE_QUERY = "(max-width: 700px)";  // matches css/mobile.css

const params = new URLSearchParams(location.search);

export const LOADING = params.has("loading");  // ?loading never fetches games, so the loading spinners stay up
// ?admin asks for the admin password and remembers it; ?admin=off forgets it (js/admin.js). null when absent.
export const ADMIN_PARAM = params.get("admin");
// The site's own API (worker/handler.js) that logs the admin in and hands out the admin code.
export const ADMIN_URL = "/api";

// ?league=nfl or ?league=college picks the starting league, for links shared with one audience.
// null when absent or unrecognized.
export const LEAGUE_PARAM = { nfl: "nfl", college: "cfb", cfb: "cfb", ncaa: "cfb" }[params.get("league")?.toLowerCase()] ?? null;

// ?game=cfb:401234567 picks that game on arrival (repeat it, or comma-separate keys, for several), for links shared
// from a card's share button. Keys are js/espn.js's "league:eventId".
export const LINKED_GAMES = params.getAll("game").flatMap((v) => v.split(",")).map((k) => k.trim())
  .filter((k) => /^(cfb|nfl):[\w-]+$/.test(k));
