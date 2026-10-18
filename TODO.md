# TODO

1. **HIGH PRIORITY: missing or late notifications.** Not every notification comes through, and some seem delayed.
   Find out where they're lost or held up (ESPN's own lag, the program's 10-second schedule, Apple's delivery, a
   phone's bells, the program restarting) and fix it.
2. **Desktop notification styling.**
3. **Mobile notification styling.** How notifications look on the phone (after desktop's, #1).
4. **Android notifications.** iPhone notifications work (Home Screen app, Web Push through `worker/phones.js`). Android
   Chrome supports the same Web Push without installing; check the flow there (Enable notifications outside an
   installed app currently stays in-page, as on a laptop) and test on a real Android phone.
5. **Faster game data than ESPN.** ESPN's clock, possession and field position only move when a play is logged, and
   some college games run minutes behind: Northwestern showed 11:42 left in the 4th while Google showed 9:43, and
   Alabama's possession dot lagged too. Try NCAA.com's public scoreboard (and others) as a source, in the program
   on Cloudflare (worker/scorekeeper.js), the one place it would need swapping in.
6. **iPhone notifications walkthrough.** On a phone, the first time someone taps Enable notifications, show a
   step-by-step walkthrough of turning them on (add to Home Screen, open the app, allow), making clear it's for iPhone
   only. Show it automatically only that first time; a gear-menu item ("How to enable notifications") reopens it.
7. **Are NFL timeouts trackable?** College timeouts were dropped because ESPN's counts don't reset at halftime
   (scripts/check-timeouts.js). Check whether ESPN's NFL timeout counts are reliable enough to show.
8. **List view: clock under the score.** Move the time/quarter to sit centered under the scores, above the down &
   distance, instead of in its own column.
9. **Bell click makes the card's buttons blink.** Clicking the hover bell on a card flickers the buttons around it.

