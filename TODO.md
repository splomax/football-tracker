# TODO

1. **Desktop notification styling.**
2. **Android notifications.** iPhone notifications work (Home Screen app, Web Push through `worker/phones.js`). Android
   Chrome supports the same Web Push without installing; check the flow there (Enable notifications outside an
   installed app currently stays in-page, as on a laptop) and test on a real Android phone.
3. **Faster game data than ESPN.** ESPN's clock, possession and field position only move when a play is logged, and
   some college games run minutes behind: Northwestern showed 11:42 left in the 4th while Google showed 9:43, and
   Alabama's possession dot lagged too. Try NCAA.com's public scoreboard (and others) as a source, in the program
   on Cloudflare (worker/scorekeeper.js), the one place it would need swapping in.
4. **iPhone notifications walkthrough.** On a phone, the first time someone taps Enable notifications, show a
   step-by-step walkthrough of turning them on (add to Home Screen, open the app, allow), making clear it's for iPhone
   only. Show it automatically only that first time; a gear-menu item ("How to enable notifications") reopens it.
5. **Are NFL timeouts trackable?** College timeouts were dropped because ESPN's counts don't reset at halftime
   (scripts/check-timeouts.js). Check whether ESPN's NFL timeout counts are reliable enough to show.
