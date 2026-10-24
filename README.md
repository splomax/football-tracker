# Game Tracker Live

Live college football and NFL games at a glance: pick the games you care about and each gets a card with the
score, clock, down and distance, a mini field showing the ball and line to gain, the last play, and the network.

Live: https://gametrackerlive.com/

## Run, test, deploy

| | |
|---|---|
| Run locally | `npm start`, then open http://localhost:4173. The app uses ES modules, which browsers won't load from `file://`, so open it through the server. That serves the files only; for the admin login too, run `npx wrangler dev --persist-to /tmp/wrangler-state` with the password in `.dev.vars` (`ADMIN_PASSWORD=...`, git-ignored). |
| Game links | A link like `?game=cfb:401234567` (the game's `league:eventId`; repeat it or comma-separate keys for several). Opening it adds the game to the viewer's own picks and flashes its card, then drops the parameter from the address bar. |
| Board image | **Save board as image** in the gear menu saves every picked game as a list made for forums: grouped by day and in kickoff order (live and final games too), kickoff times in Eastern time, logos, ranks, records and networks, in the current theme, with a small Game Tracker Live logo in the corner. A phone opens the share sheet; a computer downloads the PNG. |
| Grid or list | The button left of the theme switch flips the board between cards (grid) and one row per game (list): logos, ranks, teams and scores around an @ with the down & distance centered underneath and the network (with the recap link once a game has one) under the away team, then the clock. Rows are only as wide as the widest game, all the same width, with their columns lined up. Narrow boards (phones) stack away over home. Phones start in list, everything else in grid; the viewer's choice is remembered in each browser. |
| Halloween | Every October (decided before the page first draws), the header's football becomes a jack-o'-lantern that turns around its stem when clicked (its face slides round), the loading spinners become jack-o'-lanterns whose faces keep turning, and **google me** shows a ghost one time in four (otherwise the usual coaches). A saved `halloween` value in localStorage (true or false) overrides the date. |
| Phones | Phones (narrower than 700px, or shorter than 500px, as on their side) get the game list as a drawer behind the pinned **☰ Games** bar, which also shows the last update's time. The gear floats in the bottom-right corner, always in reach. On Final and Upcoming cards whose footer would only hold the ✕, it sits beside the scoreboard. |
| Phone app | On an iPhone, Safari's Share → **Add to Home Screen** makes Game Tracker an app (`manifest.webmanifest`, icon: the wordmark on a football field) that opens full screen with a splash screen (the logo and wordmark, a jack-o'-lantern in October) until the first scores are in, on the page it was added from. |
| Notifications | Every card (on hover with a mouse) and every game-list row has a bell (`js/notify.js`); lighting one on an unpicked game's row picks it too. The first bell asks the browser's permission, then subscribes the device (Web Push, `js/push.js`) and hands the server its lit bells; a "Notifications are on" notification confirms it. The program on Cloudflare (`worker/scorekeeper.js`) works out each game's news (`js/alerts.js`: scores from ESPN's scoring-play list, how each touchdown's try went (a made extra point is skipped), two-minute warnings, kickoff, each quarter, halftime and the final; teams by their short name, like "Cardinals @ Rams") and pushes it to the devices whose bells include that game, even with the page closed (`worker/webpush.js` sends; `worker/phones.js` keeps each device and its bells in Workers KV). Each event has a fixed name and the program saves what it has sent, so a restart neither repeats nor loses one. Computers and Android work from any browser tab; on an iPhone in Safari a bell opens a step-by-step walkthrough of adding the app to the Home Screen (also in the gear menu). Blocked notifications are explained when a bell is tapped, and noticed when the page opens (the bells show off until they're allowed again). While a device has a lit bell on a game that's live or starts within 15 minutes, the program checks ESPN every 10 seconds; every 15 minutes while bells are only on later games; otherwise not at all. A Cloudflare scheduled trigger nudges it every minute, which restarts it if a deploy dropped its schedule; deploys (CI's and `scripts/deploy.sh`) also wake it right away through `POST /api/wake`, so it doesn't sit idle until the next nudge. ESPN's scoreboard can lag its own play-by-play, so for games under way (picked ones on the page, belled ones on the server) whichever is further along wins (`js/espn.js` freshen). |
| Stats | **Stats** in the gear menu (or `?stats` in the address; the old `?stats-mode-beta` forwards to it): each live game shows each team's leading offensive player and a button that opens both teams' passing, rushing and receiving leaders and team totals, from ESPN's game detail (`js/stats.js`), refreshed every 30 seconds; finished games get a Stats link next to Recap. A game with its stats open moves to the front of its section. |
| Admin | Open the site with `?admin` and enter the admin password. The Worker trades it for a login token that lasts 30 days; only the token is kept in the browser, never the password, and while it works `?admin` skips the password. The admin features only show with `?admin` in the address bar, and it stays there while they're on. Without it a logged-in browser looks like anyone else's, but its visits still aren't counted. `?admin=off` logs out, and changing the password (`npx wrangler secret put ADMIN_PASSWORD`) logs out every browser. The admin isn't counted by the visit counter. In the game list, each section gets **Select all** and **Remove all**, and Selected gets **Remove all** for every pick in the current tab and filters. The admin's page gets its scores from the program on Cloudflare (`worker/scorekeeper.js`) instead of from ESPN directly: it asks ESPN every 10 seconds while an admin page is open, and stops once none has asked for two minutes, to stay on the free plan. If it can't be reached, the page asks ESPN itself, and the top of the gear menu says which ("Scores from: Game Tracker server" or "ESPN (server unreachable)"). The gear menu gets **Notification settings**: which kinds of notification this device gets (`js/alerts.js` NOTIFY_KINDS), saved on the server with the device (`worker/phones.js`), including kinds only admins can turn on: lead changes, turnovers, turnovers on downs and missed field goals (from how ESPN says each drive ended). Everyone else's devices get the defaults. On a computer each card also gets a paper-plane button that sends that game a test notification through the program, to admins' devices with that game's bell lit, and a chooser for which kind (a plain test, or a sample touchdown, field goal, halftime...). The gear menu also gets the visit counter's week, month and total counts at the top (read from hits.sh through the Worker at `/api/visits`, fresh each time the menu opens). That code isn't in the public site: the site's Worker (`worker/`) hands it out only to a logged-in admin. |
| MDS | **MDS** in the gear menu is the only leader highlighting: it underlines the leading team's score, colors its name and score blue and boxes the team in grey, on the cards and in the game list, remembered in that browser. |
| Loading spinner | Add `?loading` to the URL. The page never fetches games, so both loading spinners stay up. It also skips the visit counter. |
| Test | `npm install` and `npx playwright install webkit` once, then `npm test`. Playwright runs headless in your installed Google Chrome, except the tests tagged `@webkit` (Safari-only bugs, like the scroll position), which run in Playwright's WebKit. `npm run test:worker` tests the Worker. |
| Deploy | Push to `main`. CI (`.github/workflows/ci.yml`) runs the tests and, if they pass, deploys with `wrangler deploy`: one Cloudflare Worker (`wrangler.toml`) serves the repo's files (minus `.assetsignore`) on gametrackerlive.com, plus the admin API under `/api/`. There is no build step. CI needs the repo secret `CLOUDFLARE_API_TOKEN` (an "Edit Cloudflare Workers" token covering the domain); `npx wrangler deploy` also works by hand. |
| Old address | yawyawfootbaw.github.io/football-tracker now only forwards to gametrackerlive.com, keeping the path and query. GitHub Pages serves the `gh-pages` branch, built by `scripts/publish-pages-redirect.sh`; it doesn't change when main does. |
| Admin password | `npx wrangler secret put ADMIN_PASSWORD` (a long random password). Changing it logs out every browser. |
| Push key | Phone notifications are signed with a VAPID key pair: the public half is in `js/push.js`, the private half is the Worker secret `VAPID_PRIVATE_KEY` (a P-256 JWK; also in `.dev.vars` for `wrangler dev`). A backup of the pair is in `~/.vapid-gametracker.json` on the machine that made it. Replacing the pair means every phone has to turn notifications on again. |

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
  settings.js         settings gear, "google me", MDS (leader in blue) and Save board as image
  image.js            Save board as image: the picked games drawn as a list for forums
  alerts.js           what's news in a game between updates (scores, turnovers, two-minute warning, quarters) and which device gets which; runs on Cloudflare
  theme.js            light/dark theme and its header switch
  view.js             grid or list view for the board, and its header switch
  push.js             phone notifications: the service worker (sw.js), subscribing the installed app, its bells
  source.js           where the scores come from: ESPN, or the program on Cloudflare for the admin
  leagues.js          ESPN's scoreboard addresses (shared with the program on Cloudflare)
  season.js           the Halloween look (every October): jack-o'-lantern logo, ghost in google me
  logo.js             the football beside the title, which spirals once when clicked
  counter.js          hidden visit counter
fonts/                Barlow Condensed Bold for the wordmark (self-hosted, SIL Open Font License in OFL.txt)
images/               coach photos for "google me", favicon, link-preview image
scripts/
  share-images.js     regenerates the link-preview image and the home-screen icons
  preview-images.js   renders Save board as image from the test fixtures, to check its look by eye
  test-and-ship.sh    runs every test and commits and pushes only if they all pass
  deploy.sh           deploys from this machine, then starts the program on the new code right away
  find-unused.js      lists code that looks unused, for review by hand
  forum-changelog.js  the forum's BB code changelog: commits to write notes from, then screenshots and BB code from changelogs/*.json
  screenshot-matrix.js  shoots every feature state on desktop and iPhone, side by side, for comparing them
  check-local-admin.js  logs in against the Worker running locally (wrangler dev), to check the admin login path
  check-live-site.sh  checks the deployed site: pages load, private files are 404, www. redirects, the admin API refuses
  check-old-address.js  checks that old GitHub Pages links forward to gametrackerlive.com with their query
  publish-pages-redirect.sh  publishes the gh-pages branch, which turns the old GitHub Pages address into that redirect
  preview-leader-styles.js  renders the board with each style considered for marking the leading team
  check-timeouts.js   compares ESPN's live timeout counts with the play log; why cards don't show timeouts
wrangler.toml         the Cloudflare Worker that serves the site and its admin API, on gametrackerlive.com
.assetsignore         repo files the site doesn't serve (the Worker's source, tests, tooling)
worker/               the Worker's code
  admin.js            the admin's features: hiding games, notifications, visit counts, bulk select (served only by /api/admin.js)
  handler.js          serves the site's files, the admin login (signed 30-day tokens) and the admin code; index.js is the entry
  scorekeeper.js      the program on Cloudflare that fetches the scores and works out notifications (ScoreKeeper Durable Object, index.js)
  scorekeeper-object.js  the ScoreKeeper Durable Object around it: its schedule, the phones' list, sending to phones
  scorekeeper.test.js, scorekeeper-object.test.js  Node tests for those
  webpush.js          sends a phone notification (Web Push: encrypted message, signed VAPID token), no outside library
  phones.js           the phones that turned on notifications, in Workers KV, and sending to them
  webpush.test.js, phones.test.js  Node tests for those
  handler.test.js     Node tests for handler.js
  alerts.test.js      Node tests for js/alerts.js
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
