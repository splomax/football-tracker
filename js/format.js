// Small HTML helpers shared by the picker rows and the board cards.

import { currentTheme } from "./theme.js";

// ESPN's regular logos are made for light backgrounds. In dark mode use its dark-background variant, which lives
// at the same path under 500-dark, falling back to the regular logo if it's missing.
export function logoImg(t) {
  if (currentTheme() === "light") return `<img src="${t.logo}" alt="">`;
  return `<img src="${t.logo?.replace("/500/", "/500-dark/")}" alt="" onerror="this.onerror=null; this.src='${t.logo}'">`;
}

export const rankBadge = (t) => (t.rank && t.rank <= 25 ? `<span class="rank">${t.rank}</span>` : "");

/** Whether team t is ahead of other in a game that has started; a tie leads for neither. Its score gets underlined. */
export const leads = (g, t, other) => g.state !== "pre" && +t.score > +other.score;

// Always two lines so the status block is the same height in every state.
export function statusLines(g) {
  if (g.state === "in") return g.detail === "Halftime" ? "Half<br>&nbsp;" : `${g.clock}<br>${periodName(g)}`;
  if (g.state === "pre") return `${g.date.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}<br>${g.date.toLocaleDateString([], { weekday: "short" })}`;
  return `${g.detail}<br>&nbsp;`;
}

function periodName(g) {
  return g.period <= 4 ? ["1st", "2nd", "3rd", "4th"][g.period - 1] : g.period === 5 ? "OT" : `${g.period - 4}OT`;
}

export function escapeAttr(text) {
  return text.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;");
}
