# TODO

1. **Android notifications.** Android now gets pushed notifications from any Chrome tab (no install), like the
   iPhone app (js/push.js pushApplies); checked in Chrome pretending to be a Pixel. Still to do: try it on a real
   Android phone, with Chrome closed.
2. **(After Monday, Oct 26) Faster game data than ESPN.** ESPN's clock, possession and field position only move when a play is logged, and
   some college games run minutes behind: Northwestern showed 11:42 left in the 4th while Google showed 9:43, and
   Alabama's possession dot lagged too. Try NCAA.com's public scoreboard (and others) as a source, in the program
   on Cloudflare (worker/scorekeeper.js), the one place it would need swapping in.
3. **(Tomorrow, Sunday Oct 25, during the NFL games) Are NFL timeouts trackable?** College timeouts were dropped because ESPN's counts don't reset at halftime
   (scripts/check-timeouts.js). Check whether ESPN's NFL timeout counts are reliable enough to show.
4. **Notification settings.** Let people choose which events notify them (scores, red zone, two-minute warning,
    quarters, halftime, final).
5. **Bigger team logos, and check their alignment.** Grid view looks bad on desktop and mobile; list view is fine on
    both.
6. **Line-by-line code walkthrough.** Go through the code reviewing how readable it is to a person and whether its
    organization is intuitive.
