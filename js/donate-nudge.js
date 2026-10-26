// "Enjoying Game Tracker Live?" nudge toward the gear menu's Donate link (index.html): shown once per browser, on the
// first visit after the first, as the page opens. It stays until its ✕ is clicked, so a closed one means it was seen;
// then never again. A bubble over the gear on a computer, a toast above the floating gear on a phone (css/corner.css,
// css/mobile.css). While the gear menu is open it moves up above the menu on a computer and hides on a phone. Never
// for admins. ?donate shows it anyway.

import { store } from "./store.js";
import { DONATE_NUDGE } from "./config.js";

// Read before anything else writes to storage (main.js imports this first): anything saved means an earlier visit,
// which also counts everyone who used the site before the nudge existed.
const returning = store.get("visited", false) || (() => { try { return localStorage.length > 0; } catch { return false; } })();
store.set("visited", true);

export function initDonateNudge({ isAdmin }) {
  if (!DONATE_NUDGE && (!returning || isAdmin || store.get("donateNudgeSeen", false))) return;
  const nudge = document.createElement("div");
  nudge.id = "donate-nudge";
  nudge.setAttribute("role", "status");
  nudge.innerHTML = `<span>Enjoying Game Tracker Live? Consider donating to charity in the ⚙&#xFE0E; menu ❤️</span>`
    + `<button aria-label="Close">✕</button>`;
  const gear = document.getElementById("settings"), menu = document.getElementById("settings-menu");
  // Follow the gear menu (js/settings.js sets aria-expanded, then shows the menu, before this runs): --lift is how far
  // up the menu pushes it on a computer.
  const follow = new MutationObserver(() => {
    const open = gear.getAttribute("aria-expanded") === "true";
    if (open) nudge.style.setProperty("--lift", `${menu.offsetHeight + 4}px`);
    nudge.classList.toggle("menu-open", open);
  });
  follow.observe(gear, { attributes: true, attributeFilter: ["aria-expanded"] });
  nudge.querySelector("button").addEventListener("click", (e) => {
    e.stopPropagation();
    store.set("donateNudgeSeen", true);
    follow.disconnect();
    nudge.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 200, easing: "ease-in" }).onfinish = () => nudge.remove();
  });
  // Tapping the message opens the gear menu, where Donate is.
  nudge.addEventListener("click", (e) => {
    e.stopPropagation();
    if (gear.getAttribute("aria-expanded") !== "true") gear.click();
  });
  gear.before(nudge);
  nudge.animate([{ opacity: 0, transform: "translateY(6px)" }, { opacity: 1, transform: "none" }], { duration: 300, easing: "ease-out" });
}
