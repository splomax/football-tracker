# football-tracker

Scripts to use instead of redoing the work by hand (details in each file's header comment and README's file list):

- `scripts/test-and-ship.sh "message" files…`: runs all tests (`RUNS=2` for two Playwright runs) and commits and
  pushes only if everything passes. `--test-only` just runs them.
- `scripts/preview-images.js`: renders Save board as image to `previews/board.png` (needs `npm start`).
- `scripts/screenshot-corner.js`: screenshots the gear menu and coach on desktop and phone (needs `npm start`).
- `scripts/check-local-admin.js`, `scripts/check-live-site.sh`: admin login against `wrangler dev`; the deployed site.
