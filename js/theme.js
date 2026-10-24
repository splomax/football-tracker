// Light/dark theme. Follows the device setting until the viewer picks one with the header button.
// index.html applies the saved or device theme before first paint, so the page never flashes the wrong one.

import { store } from "./store.js";

const $ = (id) => document.getElementById(id);
const deviceLight = matchMedia("(prefers-color-scheme: light)");

export const currentTheme = () => document.documentElement.dataset.theme;

function apply(theme) {
  document.documentElement.dataset.theme = theme;
  const next = theme === "dark" ? "light" : "dark";
  $("theme-toggle").textContent = theme === "dark" ? "☀︎" : "☾";
  $("theme-toggle").setAttribute("aria-label", `Switch to ${next} mode`);
  $("theme-toggle").title = `Switch to ${next} mode`;
}

/** @param {{ onChange: () => void }} hooks  re-render anything theme-dependent (team logos) */
export function initTheme({ onChange }) {
  apply(currentTheme());
  const toggle = () => {
    const theme = currentTheme() === "dark" ? "light" : "dark";
    store.set("theme", theme);
    apply(theme);
    onChange();
  };
  $("theme-toggle").addEventListener("click", toggle);
  // No saved choice yet: keep following the device if it switches (e.g. at sunset).
  deviceLight.addEventListener("change", (e) => {
    if (store.get("theme")) return;
    apply(e.matches ? "light" : "dark");
    onChange();
  });
}
