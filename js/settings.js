// Settings gear in the corner. "google me" toggles a coach photo: Curt Cignetti usually, Bo Pelini one time in ten,
// and at Halloween a ghost one time in four.
// "MDS" colors the leading team blue. "Stats" turns on stats mode (js/stats.js). "Save board as image" saves the picked
// games as a list (js/image.js, loaded when first used). "Donate to Save the Children" links to the Game Tracker Live
// fundraiser on their own site (index.html), so every dollar goes to them and the page shows what it has raised.

import { store } from "./store.js";
import { isHalloween } from "./season.js";
import { statsOn, setStats } from "./stats.js";
import { renderBoard } from "./board.js";

const $ = (id) => document.getElementById(id);
let settingsBtn, settingsMenu, coach, googleMe, mdsBtn;
let settingsOpen = false;

function setSettingsMenu(open) {
  if (open === settingsOpen) return;
  settingsOpen = open;
  settingsBtn.setAttribute("aria-expanded", open);
  settingsMenu.getAnimations().forEach((a) => a.cancel());
  // Pop up out of the gear (the menu's bottom corner nearest it, css/corner.css) and drop back into it.
  const tucked = { opacity: 0, transform: "translateY(6px) scale(.9)" };
  const shown = { opacity: 1, transform: "none" };
  if (open) {
    settingsMenu.hidden = false;
    settingsMenu.animate([tucked, shown], { duration: 160, easing: "cubic-bezier(.2, .9, .3, 1.2)" });
  } else {
    settingsMenu.animate([shown, tucked], { duration: 120, easing: "ease-in" })
      .onfinish = () => { settingsMenu.hidden = true; };
  }
}

// The coach grows out of a point (the "google me" button) and shrinks back into one (that button or the gear).
function coachOffset(point) {
  const to = coach.getBoundingClientRect();
  const dx = point.left + point.width / 2 - (to.left + to.width / 2);
  const dy = point.top + point.height / 2 - (to.top + to.height / 2);
  return `translate(${dx}px, ${dy}px) scale(.08)`;
}

const COACHES = {
  ghost: { src: "images/ghost.png", alt: "A ghost in a football helmet, holding a football" },  // Halloween only
  cignetti: { src: "images/cignetti.png", alt: "Indiana head coach Curt Cignetti" },
  pelini: { src: "images/pelini.png", alt: "Former Nebraska head coach Bo Pelini" },
};

// Swap in this showing's coach and wait until the new photo can paint; otherwise the previous coach
// stays on screen for a moment after a swap.
async function pickCoach() {
  // At Halloween a ghost one time in four; otherwise (and the rest of the time) Pelini one time in ten.
  const { src, alt } = isHalloween() && Math.random() < 0.25 ? COACHES.ghost : Math.random() < 0.1 ? COACHES.pelini : COACHES.cignetti;
  const img = coach.querySelector("img");
  img.alt = alt;
  if (img.getAttribute("src") !== src) {
    img.src = src;
    await img.decode().catch(() => {});  // a failed load still shows (as alt text) rather than blocking
  }
}

async function showCoach(from) {
  coach.getAnimations().forEach((a) => a.cancel());  // a cancelled hide never fires onfinish
  googleMe.setAttribute("aria-pressed", true);
  await pickCoach();
  if (googleMe.getAttribute("aria-pressed") !== "true") return;  // turned off again while the photo loaded
  coach.hidden = false;  // before coachOffset, which needs the coach laid out
  coach.animate([
    { transform: coachOffset(from), opacity: 0 },
    { opacity: 1, offset: .3 },
    { transform: "none", opacity: 1 },
  ], { duration: 550, easing: "cubic-bezier(.2, .9, .3, 1.15)" });
}

function hideCoach(into) {
  coach.getAnimations().forEach((a) => a.cancel());  // a cancelled hide never fires onfinish
  googleMe.setAttribute("aria-pressed", false);
  coach.animate([
    { transform: "none", opacity: 1 },
    { opacity: 1, offset: .7 },
    { transform: coachOffset(into), opacity: 0 },
  ], { duration: 400, easing: "cubic-bezier(.5, 0, .75, 0)" }).onfinish = () => { coach.hidden = true; };
}

// "MDS": the leading team's name and score in blue (css/board.css, css/picker.css), remembered in this browser.
function setBlue(on) {
  mdsBtn.setAttribute("aria-pressed", on);
  document.body.classList.toggle("mds-blue", on);
  store.set("mdsBlue", on);
}

export function initSettings() {
  for (const [who, { src }] of Object.entries(COACHES)) if (who !== "ghost" || isHalloween()) new Image().src = src;  // preload so a swap is instant
  settingsBtn = $("settings");
  settingsMenu = $("settings-menu");
  coach = $("coach");
  googleMe = $("google-me");
  mdsBtn = $("mds-blue");
  mdsBtn.addEventListener("click", () => setBlue(mdsBtn.getAttribute("aria-pressed") !== "true"));
  setBlue(store.get("mdsBlue", false));
  const statsBtn = $("menu-stats");
  statsBtn.setAttribute("aria-pressed", statsOn());
  statsBtn.addEventListener("click", () => {
    setStats(!statsOn());
    statsBtn.setAttribute("aria-pressed", statsOn());
    renderBoard();
  });

  settingsBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    setSettingsMenu(!settingsOpen);
  });
  // The menu stays open, so you can keep clicking "google me" (re-rolling the coach) without reopening it.
  googleMe.addEventListener("click", () => {
    const from = googleMe.getBoundingClientRect();
    googleMe.getAttribute("aria-pressed") === "true" ? hideCoach(from) : showCoach(from);
  });
  $("save-board").addEventListener("click", () => import("./image.js").then((m) => m.saveBoardImage()));
  coach.addEventListener("click", () => {
    if (googleMe.getAttribute("aria-pressed") === "true") hideCoach(settingsBtn.getBoundingClientRect());
  });
  document.addEventListener("click", (e) => { if (!settingsMenu.contains(e.target)) setSettingsMenu(false); });
  document.addEventListener("keydown", (e) => { if (e.key === "Escape") setSettingsMenu(false); });
}
