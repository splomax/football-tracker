# TODO

1. **Desktop notification styling.**
2. **Mobile notification styling.** How notifications look on the phone (after desktop's, #1).
3. **Android notifications.** iPhone notifications work (Home Screen app, Web Push through `worker/phones.js`). Android
   Chrome supports the same Web Push without installing; check the flow there (Enable notifications outside an
   installed app currently stays in-page, as on a laptop) and test on a real Android phone.
4. **Faster game data than ESPN.** ESPN's clock, possession and field position only move when a play is logged, and
   some college games run minutes behind: Northwestern showed 11:42 left in the 4th while Google showed 9:43, and
   Alabama's possession dot lagged too. Try NCAA.com's public scoreboard (and others) as a source, in the program
   on Cloudflare (worker/scorekeeper.js), the one place it would need swapping in.
5. **iPhone notifications walkthrough.** On a phone, the first time someone taps Enable notifications, show a
   step-by-step walkthrough of turning them on (add to Home Screen, open the app, allow), making clear it's for iPhone
   only. Show it automatically only that first time; a gear-menu item ("How to enable notifications") reopens it.
6. **Are NFL timeouts trackable?** College timeouts were dropped because ESPN's counts don't reset at halftime
   (scripts/check-timeouts.js). Check whether ESPN's NFL timeout counts are reliable enough to show.
7. **Bell click makes the card's buttons blink.** Clicking the hover bell on a card flickers the buttons around it.

8. **Notification settings.** Let people choose which events notify them (scores, red zone, two-minute warning,
    quarters, halftime, final).
9. **Drop "Enable notifications" when notifications go live for everyone.** The gear-menu item is the admin's switch;
    once everyone has notifications, it goes (the bells would be how people subscribe).
10. **Score alignment in the game list.** Scores don't line up from card to card (a Final card's sit further left
    than the live ones').
11. **Remove "List view" and "Light mode" from the gear menu.**
12. **Recap link in list view.** It looks great on grid cards but out of place in list rows.
13. **Bigger team logos, and check their alignment.** Grid view looks bad on desktop and mobile; list view is fine on
    both.
14. **Line-by-line code walkthrough.** Go through the code reviewing how readable it is to a person and whether its
    organization is intuitive.
15. **Upcoming games in list view on desktop.** Their rows look out of place.
16. **Blocked notifications.** If someone taps "Don't Allow", the browser never asks again. Detect it (the page can
    tell allowed, blocked and not asked yet) and, when they light a bell, tell them notifications are blocked with
    the steps for their device (iPhone: Settings → Notifications → Game Tracker; desktop Chrome: the icon left of the
    address → Notifications). Check again whenever the app opens, in case they changed it in Settings. Not tied to the
    gear menu's Enable notifications, which is going away (#9).
