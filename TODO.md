# TODO

1. **Android notifications.** Android now gets pushed notifications from any Chrome tab (no install), like the
   iPhone app (js/push.js pushApplies); checked in Chrome pretending to be a Pixel. Still to do: try it on a real
   Android phone, with Chrome closed.
2. **Faster game data than ESPN.** ESPN's clock, possession and field position only move when a play is logged, and
   some college games run minutes behind: Northwestern showed 11:42 left in the 4th while Google showed 9:43, and
   Alabama's possession dot lagged too. Try NCAA.com's public scoreboard (and others) as a source, in the program
   on Cloudflare (worker/scorekeeper.js), the one place it would need swapping in.
3. **Are NFL timeouts trackable?** College timeouts were dropped because ESPN's counts don't reset at halftime
   (scripts/check-timeouts.js). Check whether ESPN's NFL timeout counts are reliable enough to show.
4. **Notification settings.** Let people choose which events notify them (scores, red zone, two-minute warning,
    quarters, halftime, final).
5. **Score alignment in the game list.** Scores don't line up from card to card (a Final card's sit further left
    than the live ones').
6. **Remove "List view" and "Light mode" from the gear menu.**
7. **Recap link in list view.** It looks great on grid cards but out of place in list rows.
8. **Bigger team logos, and check their alignment.** Grid view looks bad on desktop and mobile; list view is fine on
    both.
9. **Line-by-line code walkthrough.** Go through the code reviewing how readable it is to a person and whether its
    organization is intuitive.
10. **Upcoming games in list view on desktop.** Their rows look out of place.
11. **Stats mode's arrow button.** It works but still feels clunky; find a better way to open a live game's detailed
    stats.
