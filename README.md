# Game Tracker

Live college football and NFL games at a glance: pick the games you care about and each gets a card with the
score, clock, down and distance, a mini field showing the ball and line to gain, the last play, and the network.

Live: https://gametrackerlive.com/

## Run, test, deploy

| | |
|---|---|
| Run locally | `npm start`, then open http://localhost:4173. The app uses ES modules, which browsers won't load from `file://`, so open it through the server. That serves the files only; for the admin login too, run `npx wrangler dev --persist-to /tmp/wrangler-state` with the password in `.dev.vars` (`ADMIN_PASSWORD=...`, git-ignored). |
| Game links | For the admin, each live card's share button opens the phone's share sheet, or copies the link with a mouse. The link is `?game=cfb:401234567` (the game's `league:eventId`; repeat it or comma-separate keys for several). Opening it adds the game to the viewer's own picks and flashes its card, then drops the parameter from the address bar. |
| Admin | Open the site with `?admin` and enter the admin password. The Worker trades it for a login token that lasts 30 days; only the token is kept in the browser, never the password, and while it works `?admin` skips the password. The admin features only show with `?admin` in the address bar, and it stays there while they're on. Without it a logged-in browser looks like anyone else's, but its visits still aren't counted. `?admin=off` logs out, and changing the password (`npx wrangler secret put ADMIN_PASSWORD`) logs out every browser. The admin isn't counted by the visit counter and gets share buttons on live cards and **Save as image** beside each section heading. Live and Final save that section's cards as they look; Upcoming saves a list made for forums (grouped by day, kickoff times in Eastern time, logos, ranks, records and networks). In the game list, each section gets **Select all** and **Remove all**, and Selected gets **Remove all** for every pick in the current tab and filters. The gear menu also gets **Save board as image**, the whole board as it looks right now, and the visit counter's week, month and total counts at the top (read from hits.sh through the Worker at `/api/visits`, fresh each time the menu opens). The gear menu also gets **MDS demo games**, which shows off MDS mode with three fake live games whose scores swing every 4 seconds (never saved as picks); it switches MDS mode on too. Card buttons are left out, every image carries a small Game Tracker logo in the corner, and a phone opens the share sheet while a computer downloads the PNG. That code isn't in the public site: the site's Worker (`worker/`) hands it out only to a logged-in admin. |
| MDS mode | Anyone can switch it on in the gear menu, and the browser remembers it. A share link switches it on for one visit: `?mds`, or `?mds=demo` with three fake live games whose scores swing every 4 seconds (any case; neither is remembered). FOOTBALL IS HAPPENING scrolls up the left edge and down the right; the leading team's name turns blue, with a huge red arrow jabbing at it from the side; a lead change sets off explosions and a banner; an air horn keeps blaring every few seconds while anyone leads; a tie gets a sad trombone; and missiles keep hitting the leaders' rows in the game list that are on screen. Sound starts after the yellow button (or any click), since browsers won't play sound before one. Its code (`js/mds.js`, `css/mds.css`) only downloads once it's switched on. |
| Loading spinner | Add `?loading` to the URL. The page never fetches games, so both loading spinners stay up. It also skips the visit counter. |
| Test | `npm install` once, then `npm test`. Playwright runs headless in your installed Google Chrome. `npm run test:worker` tests the Worker. |
| Deploy | Push to `main`. CI (`.github/workflows/ci.yml`) runs the tests and, if they pass, deploys with `wrangler deploy`: one Cloudflare Worker (`wrangler.toml`) serves the repo's files (minus `.assetsignore`) on gametrackerlive.com, plus the admin API under `/api/`. There is no build step. CI needs the repo secret `CLOUDFLARE_API_TOKEN` (an "Edit Cloudflare Workers" token covering the domain); `npx wrangler deploy` also works by hand. |
| Old address | yawyawfootbaw.github.io/football-tracker now only forwards to gametrackerlive.com, keeping the path and query. GitHub Pages serves the `gh-pages` branch, built by `scripts/publish-pages-redirect.sh`; it doesn't change when main does. |
| Admin password | `npx wrangler secret put ADMIN_PASSWORD` (a long random password). Changing it logs out every browser. |

CI runs the tests on every push and pull request too.


## How it's organized

No framework and no build: one HTML page, plain CSS, and native JavaScript modules.

```
index.html            page markup; loads the CSS and js/main.js
css/
  base.css            color tokens, page layout, spinner
  picker.css          game picker: tabs, filters, sections, score-bug rows
  board.css           board sections, game cards, field, last play, remove button
  corner.css          contact footer, settings gear, coach photo
  mobile.css          phone layout (≤700px): slide-in picker drawer, tighter cards
  mds.css             MDS mode's overlay, banner and sound button (loaded by js/mds.js)
js/
  main.js             entry point: wires modules together and polls ESPN every 10s
  config.js           API URLs, timings, ?admin (login), ADMIN_URL, ?loading, ?league and ?game parameters
  store.js            localStorage wrapper that never throws
  state.js            state shared by picker and board (games, picks, tab, filters, …)
  espn.js             fetches ESPN's scoreboard and normalizes each game
  picker.js           the game list: rendering, filters, sections, selection
  board.js            the cards: Live/Final/Upcoming sections, red-zone glow, highlight, last-play popover, hooks for the admin's controls
  admin.js            admin login: trades the password for a token, then fetches the admin code with it
  recap.js            checks finished games for ESPN's written recap
  field.js            the SVG field on each card
  format.js           small shared HTML helpers (logos, status lines, escaping)
  drawer.js           hiding/showing the picker: desktop side panel, phone drawer
  settings.js         settings gear, "google me" and the MDS mode switch
  theme.js            light/dark theme and its header switch
  logo.js             the football beside the title, which spirals once when clicked
  counter.js          hidden visit counter
  mds.js              MDS mode (gear menu): arrows, explosions, missiles, synthesized air horn, demo games
fonts/                Barlow Condensed Bold for the wordmark (self-hosted, SIL Open Font License in OFL.txt)
images/               coach photos for "google me", favicon, link-preview image
scripts/
  share-images.js     regenerates the link-preview image and touch icon
  preview-images.js   renders the admin's image exports from the test fixtures, to check their look by eye
  check-local-admin.js  logs in against the Worker running locally (wrangler dev), to check the admin login path
  check-live-site.sh  checks the deployed site: pages load, private files are 404, www. redirects, the admin API refuses
  check-old-address.js  checks that old GitHub Pages links forward to gametrackerlive.com with their query
  publish-pages-redirect.sh  publishes the gh-pages branch, which turns the old GitHub Pages address into that redirect
  preview-leader-styles.js  renders the board with each style considered for marking the leading team
  preview-mds.js      screenshots MDS mode with its demo games as the fake scores change
  check-timeouts.js   compares ESPN's live timeout counts with the play log; why cards don't show timeouts
wrangler.toml         the Cloudflare Worker that serves the site and its admin API, on gametrackerlive.com
.assetsignore         repo files the site doesn't serve (the Worker's source, tests, tooling)
worker/               the Worker's code
  admin.js            the admin's features: share buttons, image exports, bulk select (served only by /api/admin.js)
  handler.js          serves the site's files, the admin login (signed 30-day tokens) and the admin code; index.js is the entry
  handler.test.js     Node tests for handler.js
tests/
  app.spec.js         end-to-end tests, grouped by feature
  fixtures.js         fake ESPN data: one game per situation the app handles
```

`main.js` is the only module that sets up listeners, timers or network requests on load; the others export
functions. The picker and board
don't import each other: `main.js` passes each one the callbacks it needs.

## Data

- **Source:** ESPN's public but unofficial scoreboard API (`site.api.espn.com`). It needs no key and allows
  requests from any website. It's undocumented, so it could change without notice. Check ESPN's terms of use
  before any commercial use.
- **College** covers FBS games only (`groups=80`); FCS-only matchups aren't listed.
- **Recaps:** ESPN posts its written recap a while after a game ends, usually 5–50 minutes (one weekend's
  sample; a few took half a day). The app checks each picked final game's summary every 2 minutes for up to an
  hour and shows a Recap link once the story exists.
- **Finished games** stay listed until ESPN's football week rolls over. ESPN's calendar data puts that at
  early Monday for college and early Wednesday for NFL, Eastern time.
