# football-tracker

Open work is in `TODO.md`.

**Every UI change is checked in four layouts: mobile grid, mobile list, desktop grid, desktop list**, each with live,
upcoming and finished games. Share as many styles as possible across them; desktop may differ more on purpose. Check
all four with `node scripts/screenshot-matrix.js board-grid board-list` before shipping.

Scripts to use instead of redoing the work by hand (details in each file's header comment and README's file list):

- `scripts/test-and-ship.sh "message" files…`: runs all tests (`RUNS=2` for two Playwright runs) and commits and
  pushes only if everything passes. `--test-only` just runs them.
- `scripts/preview-images.js`: renders Save board as image to `previews/board.png` (needs `npm start`).
- `scripts/find-unused.js` (**IN PROGRESS, not trusted yet**): lists code that looks unused (exports, admin hooks,
  top-level names, CSS classes/ids/variables/keyframes, storage keys). After every run, verify each hit by hand and
  look for misses, record the result in the script's "Track record" and fix what it got wrong. Drop the IN PROGRESS
  mark (here and in the script) once a few runs in a row need no corrections.
- `scripts/screenshot-matrix.js [state …]`: every feature state on desktop Chrome and iPhone WebKit, side by side in
  `previews/matrix/index.html` (needs `npm start` and `npx playwright install webkit`).
- `scripts/forum-changelog.js commits [--since DATE]`, then `render changelogs/<date>.json`: the BB code changelog for
  the forum. Notes are high-level features written by hand (not commit messages); notification work stays under
  "Coming soon" until it's out of testing. Screenshots and BB code go to a temp dir for uploading to imgur by hand.
  Start `npm start` in the same shell command as `render`: a server left in the background died mid-run.
- `scripts/check-local-admin.js`, `scripts/check-live-site.sh`: admin login against `wrangler dev`; the deployed site.
