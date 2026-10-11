// Settings gear in the corner. "google me" toggles a coach photo: Curt Cignetti usually, Bo Pelini one time in ten.
// "MDS mode" switches on js/mds.js (loaded the first time), remembered in this browser.

import { store } from "./store.js";

const $ = (id) => document.getElementById(id);
let settingsBtn, settingsMenu, coach, googleMe, mdsBtn, mdsHooks, mdsModule;
let settingsOpen = false;

function setSettingsMenu(open) {
  if (open === settingsOpen) return;
  settingsOpen = open;
  settingsBtn.setAttribute("aria-expanded", open);
  settingsMenu.getAnimations().forEach((a) => a.cancel());
  // Pop up out of the gear (bottom-left corner) and drop back into it.
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
  cignetti: { src: "images/cignetti.png", alt: "Indiana head coach Curt Cignetti" },
  pelini: { src: "images/pelini.png", alt: "Former Nebraska head coach Bo Pelini" },
};

// Swap in this showing's coach and wait until the new photo can paint; otherwise the previous coach
// stays on screen for a moment after a swap.
async function pickCoach() {
  const { src, alt } = Math.random() < 0.1 ? COACHES.pelini : COACHES.cignetti;
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

/** The MDS mode module, loaded on first use. */
export const loadMds = async () => (mdsModule ??= await import("./mds.js"));

/** Switches MDS mode on or off and remembers it; fires "mds-change" on document so the admin's demo switch follows. */
export async function setMds(on) {
  mdsBtn.setAttribute("aria-pressed", on);
  store.set("mds", on);
  if (!on && !mdsModule) return;
  const mds = await loadMds();
  on ? mds.start(mdsHooks) : mds.stop();
  document.dispatchEvent(new CustomEvent("mds-change", { detail: on }));
}

/** @param {{ mds: object }} hooks  what js/mds.js's start() needs: { state, renderBoard, renderList, setExtraGames } */
export function initSettings({ mds }) {
  mdsHooks = mds;
  for (const { src } of Object.values(COACHES)) new Image().src = src;  // preload so a swap is instant
  settingsBtn = $("settings");
  settingsMenu = $("settings-menu");
  coach = $("coach");
  googleMe = $("google-me");
  mdsBtn = $("mds-mode");
  mdsBtn.addEventListener("click", () => setMds(mdsBtn.getAttribute("aria-pressed") !== "true"));
  if (store.get("mds", false)) setMds(true);

  settingsBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    setSettingsMenu(!settingsOpen);
  });
  // The menu stays open, so you can keep clicking "google me" (re-rolling the coach) without reopening it.
  googleMe.addEventListener("click", () => {
    const from = googleMe.getBoundingClientRect();
    googleMe.getAttribute("aria-pressed") === "true" ? hideCoach(from) : showCoach(from);
  });
  coach.addEventListener("click", () => {
    if (googleMe.getAttribute("aria-pressed") === "true") hideCoach(settingsBtn.getBoundingClientRect());
  });
  document.addEventListener("click", (e) => { if (!settingsMenu.contains(e.target)) setSettingsMenu(false); });
  document.addEventListener("keydown", (e) => { if (e.key === "Escape") setSettingsMenu(false); });
}
