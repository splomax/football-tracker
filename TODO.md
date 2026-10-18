# TODO

1. **Desktop notification styling.**
2. **Phone notifications** (Web Push from the backend, worker/hub.js, which will then need to poll through games, not just while an admin page is open; on iPhone the site has to be added to the Home Screen).
3. **Faster game data than ESPN.** ESPN's clock, possession and field position only move when a play is logged, and
   some college games run minutes behind: Northwestern showed 11:42 left in the 4th while Google showed 9:43, and
   Alabama's possession dot lagged too. Try NCAA.com's public scoreboard (and others) as a source, in the backend
   (worker/hub.js), which now has one place to swap it in.
