# TODO

1. **Move the ESPN polling and digesting to a backend.** Today every browser fetches ESPN itself (`js/espn.js`,
   `js/main.js`) and works out notifications on the page (`js/alerts.js`). Move that into the Worker (a cron that polls
   ESPN and runs `js/alerts.js`). Then add an admin-only button on each game card that forces a test notification for
   that game through the backend, to make notifications easy to test.
2. **Desktop notification styling.**
3. **Phone notifications** (Web Push from the backend; on iPhone the site has to be added to the Home Screen).
4. **Halloween.** Replace the header's football with a jack-o'-lantern that also spins when clicked. "google me" gets
   a 25% chance of showing a ghost.
5. **Faster game data than ESPN.** ESPN's clock, possession and field position only move when a play is logged, and
   some college games run minutes behind (Alabama's possession dot lagged too) (Northwestern showed 11:42 left in the 4th while Google showed 9:43). Try NCAA.com's public scoreboard (and
   others) as a source, likely as part of the backend in #1.
6. **Narrower list view on desktop.** Rows are too wide: move the network to the lower left of each row (the second
   line, under the away team) and bring the width down.
7. **Desktop vs. mobile analysis.** A complete analysis of every feature's disparity between desktop and mobile (how
   each one looks and works on a phone vs. a computer, and what's missing, broken or awkward on either), leaving out
   notifications (TODO #2 and #3) for now.
8. **Rebrand to "Game Tracker Live".** Update the name everywhere it shows (header wordmark, page title, link
   previews, images, README).
