// "Enjoying Game Tracker Live?" nudge toward the gear menu's Donate link (index.html): shown once per browser, on the
// first visit after the first, as the page opens. It stays until closed (✕), tapped (opens the gear menu) or the
// gear is opened, so a closed one means it was seen; then never again. A bubble over the gear on a computer, a toast
// above the floating gear on a phone (css/corner.css, css/mobile.css). Never for admins.

import { store } from "./store.js";

// Read before anything else writes to storage (main.js imports this first): anything saved means an earlier visit,
// which also counts everyone who used the site before the nudge existed.
const returning = store.get("visited", false) || (() => { try { return localStorage.length > 0; } catch { return false; } })();
store.set("visited", true);

export function initDonateNudge({ isAdmin }) {
  if (!returning || isAdmin || store.get("donateNudgeSeen", false)) return;
  const nudge = document.createElement("div");
  nudge.id = "donate-nudge";
  nudge.setAttribute("role", "status");
  nudge.innerHTML = `<span>Enjoying Game Tracker Live? Consider donating to charity in the ⚙&#xFE0E; menu ❤️</span>`
    + `<button aria-label="Close">✕</button>`;
  const gear = document.getElementById("settings");
  const close = () => {
    store.set("donateNudgeSeen", true);
    gear.removeEventListener("click", close);
    nudge.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 200, easing: "ease-in" }).onfinish = () => nudge.remove();
  };
  nudge.querySelector("button").addEventListener("click", (e) => { e.stopPropagation(); close(); });
  // Tapping the message opens the gear menu, where Donate is. The gear's own click closes the nudge.
  nudge.addEventListener("click", (e) => { e.stopPropagation(); gear.click(); });
  gear.addEventListener("click", close);
  gear.before(nudge);
  nudge.animate([{ opacity: 0, transform: "translateY(6px)" }, { opacity: 1, transform: "none" }], { duration: 300, easing: "ease-out" });
}
