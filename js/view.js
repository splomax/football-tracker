// Grid or list view for the board, switched by the header button and remembered in this browser. Grid is the cards;
// list is one full-width row per game (js/board.js lineCard, css/board.css .card.line).

import { store } from "./store.js";

const $ = (id) => document.getElementById(id);
const ICONS = {  // each shows the view the button switches to
  grid: `<path d="M4 4h6v6H4zM14 4h6v6h-6zM4 14h6v6H4zM14 14h6v6h-6z"/>`,
  list: `<path d="M4 6h16M4 12h16M4 18h16"/>`,
};

export const isListView = () => document.body.classList.contains("list-view");

function apply(view) {
  document.body.classList.toggle("list-view", view === "list");
  const next = view === "list" ? "grid" : "list";
  const button = $("view-toggle");
  button.innerHTML = `<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2.2"
    stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICONS[next]}</svg>`;
  button.setAttribute("aria-label", `Switch to ${next} view`);
  button.title = `Switch to ${next} view`;
}

/** @param {{ onChange: () => void }} hooks  redraw the board in the new view */
export function initView({ onChange }) {
  apply(store.get("view", "grid"));
  $("view-toggle").addEventListener("click", () => {
    const view = isListView() ? "grid" : "list";
    store.set("view", view);
    apply(view);
    onChange();
  });
}
