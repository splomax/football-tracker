# football-tracker

Open work is in `TODO.md`.

Scripts to use instead of redoing the work by hand (details in each file's header comment and README's file list):

- `scripts/test-and-ship.sh "message" files…`: runs all tests (`RUNS=2` for two Playwright runs) and commits and
  pushes only if everything passes. `--test-only` just runs them.
- `scripts/preview-images.js`: renders Save board as image to `previews/board.png` (needs `npm start`).
- `scripts/find-unused.js` (**IN PROGRESS, not trusted yet**): lists code that looks unused (exports, admin hooks,
  top-level names, CSS classes/ids/variables/keyframes, storage keys). After every run, verify each hit by hand and
  look for misses, record the result in the script's "Track record" and fix what it got wrong. Drop the IN PROGRESS
  mark (here and in the script) once a few runs in a row need no corrections.
- `scripts/check-local-admin.js`, `scripts/check-live-site.sh`: admin login against `wrangler dev`; the deployed site.
