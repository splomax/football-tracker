# TODO

1. **Move fetching scores and working out notifications to Cloudflare.** Today every open page asks ESPN for the
   scores and works out when to send a notification itself, by comparing each update with the one before (the score
   went up: touchdown; the clock crossed 2:00: two-minute warning). Move both jobs to a program running on Cloudflare,
   in one place, so they happen even with no page open (phone notifications will need that). Then add an admin-only
   button on each game card that sends that game a test notification through it, to make notifications easy to test.
2. **Desktop notification styling.**
3. **Phone notifications** (Web Push from the backend; on iPhone the site has to be added to the Home Screen).
4. **Faster game data than ESPN.** ESPN's clock, possession and field position only move when a play is logged, and
   some college games run minutes behind: Northwestern showed 11:42 left in the 4th while Google showed 9:43, and
   Alabama's possession dot lagged too. Try NCAA.com's public scoreboard (and others) as a source, likely as part of
   the backend in #1.
