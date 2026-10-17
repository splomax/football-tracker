# TODO

1. **Move the ESPN polling and digesting to a backend.** Today every browser fetches ESPN itself (`js/espn.js`,
   `js/main.js`) and works out notifications on the page (`js/alerts.js`). Move that into the Worker (a cron that polls
   ESPN and runs `js/alerts.js`). Then add an admin-only button on each game card that forces a test notification for
   that game through the backend, to make notifications easy to test.
2. **Desktop notification styling.**
3. **Phone notifications** (Web Push from the backend; on iPhone the site has to be added to the Home Screen).
4. **Replace "hide" with hiding games from the game list.** Remove the card eye button (cover a game, keep it picked)
   and its code. Instead, give each game-list row an admin-only eye that works like the row bell (shows on hover, lit
   when on). Hiding a game moves its row into a new "Hidden" section at the very bottom of the list, for games that
   will never matter.
5. **Halloween.** Replace the header's football with a jack-o'-lantern that also spins when clicked. "google me" gets
   a 25% chance of showing a ghost.
