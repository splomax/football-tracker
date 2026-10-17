# Game Tracker

Live college football and NFL games at a glance: pick the games you care about and each gets a card with the
score, clock, down and distance, a mini field showing the ball and line to gain, the last play, and the network.

Live: https://gametrackerlive.com/

## Run, test, deploy

| | |
|---|---|
| Run locally | `npm start`, then open http://localhost:4173. The app uses ES modules, which browsers won't load from `file://`, so open it through the server. That serves the files only; for the admin login too, run `npx wrangler dev --persist-to /tmp/wrangler-state` with the password in `.dev.vars` (`ADMIN_PASSWORD=...`, git-ignored). |
| Game links | For the admin, each live card's share button opens the phone's share sheet, or copies the link with a mouse. The link is `?game=cfb:401234567` (the game's `league:eventId`; repeat it or comma-separate keys for several). Opening it adds the game to the viewer's own picks and flashes its card, then drops the parameter from the address bar. |
| Board image | **Save board as image** in the gear menu saves every picked game as a list made for forums: grouped by day and in kickoff order (live and final games too), kickoff times in Eastern time, logos, ranks, records and networks, in the current theme, with a small Game Tracker logo in the corner. A phone opens the share sheet; a computer downloads the PNG. |
| Admin | Open the site with `?admin` and enter the admin password. The Worker trades it for a login token that lasts 30 days; only the token is kept in the browser, never the password, and while it works `?admin` skips the password. The admin features only show with `?admin` in the address bar, and it stays there while they're on. Without it a logged-in browser looks like anyone else's, but its visits still aren't counted. `?admin=off` logs out, and changing the password (`npx wrangler secret put ADMIN_PASSWORD`) logs out every browser. The admin isn't counted by the visit counter and gets share buttons on live cards. In the game list, each section gets **Select all** and **Remove all**, and Selected gets **Remove all** for every pick in the current tab and filters. The gear menu also gets the visit counter's week, month and total counts at the top (read from hits.sh through the Worker at `/api/visits`, fresh each time the menu opens). That code isn't in the public site: the site's Worker (`worker/`) hands it out only to a logged-in admin. |
| MDS | **MDS** in the gear menu colors the leading team's name and score blue and boxes the team in grey, on the cards and in the game list, remembered in that browser. A `?mds` link (any case) also turns on the loud version for that visit, with MDS shown on in the gear menu; switching MDS off there ends the loud version until the next `?mds` visit (switching it back on is just the blue). The loud version: FOOTBALL IS HAPPENING scrolls up the left edge and down the right, with the page fitted between them; the leading team's name turns blue, with a huge red arrow jabbing at it from the side and a small one at its score in the game list (on a phone the big ones point down at the score from above, and the small ones point right at the score from its left); a lead change sets off explosions and a banner; banners shout things like HOLY SHIT every so often (taking turns, overlapping only for a moment); every 8 to 14 seconds a missile flies in from the lower right corner at a leader (in the game list, or on the board when the list is closed); and fireworks go up about every half minute, sometimes two or three at once. It always brings three fake live games, already in progress, beside the visitor's own picks (once ESPN's first answer is in), whose scores swing every few seconds (never saved as picks). It starts calm and builds to full speed over its first 30 seconds. No sound. Its code (`js/mds.js`, `css/mds.css`) only downloads with the link. |
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
  mds.css             the loud MDS's overlay, banners and side scrollers (loaded by js/mds.js)
js/
  main.js             entry point: wires modules together and polls ESPN every 10s
  config.js           API URLs, timings, ?admin (login), ADMIN_URL, ?loading, ?mds, ?league and ?game parameters
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
  settings.js         settings gear, "google me", MDS (leader in blue), the ?mds link and Save board as image
  image.js            Save board as image: the picked games drawn as a list for forums
  theme.js            light/dark theme and its header switch
  logo.js             the football beside the title, which spirals once when clicked
  counter.js          hidden visit counter
  mds.js              the loud MDS (?mds): arrows, explosions, missiles, fireworks, fake games
fonts/                Barlow Condensed Bold for the wordmark (self-hosted, SIL Open Font License in OFL.txt)
images/               coach photos for "google me", favicon, link-preview image
scripts/
  share-images.js     regenerates the link-preview image and touch icon
  preview-images.js   renders Save board as image from the test fixtures, to check its look by eye
  check-local-admin.js  logs in against the Worker running locally (wrangler dev), to check the admin login path
  check-live-site.sh  checks the deployed site: pages load, private files are 404, www. redirects, the admin API refuses
  check-old-address.js  checks that old GitHub Pages links forward to gametrackerlive.com with their query
  publish-pages-redirect.sh  publishes the gh-pages branch, which turns the old GitHub Pages address into that redirect
  preview-leader-styles.js  renders the board with each style considered for marking the leading team
  preview-mds.js      screenshots the loud MDS (?mds) from the moment it loads
  check-timeouts.js   compares ESPN's live timeout counts with the play log; why cards don't show timeouts
wrangler.toml         the Cloudflare Worker that serves the site and its admin API, on gametrackerlive.com
.assetsignore         repo files the site doesn't serve (the Worker's source, tests, tooling)
worker/               the Worker's code
  admin.js            the admin's features: share buttons, visit counts, bulk select (served only by /api/admin.js)
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
