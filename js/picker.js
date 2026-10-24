// The game picker: tabs, filters, collapsible sections and score-bug rows.

import { LIST_REFRESH_MS } from "./config.js";
import { store } from "./store.js";
import { state, saveSelected } from "./state.js";
import { confNames, NFL_DIVISIONS } from "./espn.js";
import { logoImg, rankBadge, statusLines, leads } from "./format.js";
import { bellButton, onListBell } from "./notify.js";

const $ = (id) => document.getElementById(id);
const ORDER = { in: 0, pre: 1, post: 2 };
const GROUPS = { in: "Live", pre: "Upcoming", post: "Final" };
const CHEVRON = `<svg class="chev" viewBox="0 0 10 6" aria-hidden="true"><path d="M1 1l4 4 4-4" fill="none" stroke="currentColor" stroke-width="1.5"/></svg>`;

let lastListRender = -Infinity;
let lastListEmpty = true;  // the last render had no rows (or was still loading)
let spinner;               // the list's loading spinner from index.html, shown until ESPN has answered for the tab

// A logged-in admin (js/admin.js) gets the bulk buttons on every section, not only while filtered.
let admin = { bulkAlways: false };

/** @param {{ bulkAlways?: boolean }} hooks */
export function setPickerAdmin(hooks) {
  admin = { ...admin, ...hooks };
}

/**
 * True once the list has gone LIST_REFRESH_MS without a render (polls refresh it no more often than that), and always
 * while it shows no games: rows arriving can't shift anything under your finger, and a failed or empty first answer
 * from ESPN shouldn't leave the list blank for half a minute.
 */
export const listIsStale = () => lastListEmpty || Date.now() - lastListRender >= LIST_REFRESH_MS;

/** The current tab's games that pass its filters, as they stand now: Live, then Upcoming, then Final. */
export function listView() {
  const { tab, filters, games } = state;
  const f = filters[tab];
  const ranked = (t) => t.rank && t.rank <= 25;
  // NFL choices can be a whole conference ("AFC") or a division ("AFC East").
  const inConf = (t) => f.confs.some((c) => t.conf === c || (tab === "nfl" && t.conf?.startsWith(c + " ")));
  return games[tab]
    .filter((g) => !f.confs.length || inConf(g.away) || inConf(g.home))
    .filter((g) => !f.top25 || ranked(g.away) || ranked(g.home))
    .sort((a, b) => ORDER[a.state] - ORDER[b.state] || a.date - b.date);
}

export function renderList() {
  lastListRender = Date.now();
  const { tab, filters, selected } = state;
  document.querySelectorAll(".tabs button").forEach((b) => b.classList.toggle("on", b.dataset.league === tab));
  renderFilters();
  const f = filters[tab];
  const list = listView();
  // Selected games go first under their own heading, keeping the same order as the full list.
  const ordered = [...list.filter((g) => selected.has(g.key)), ...list.filter((g) => !selected.has(g.key))];
  const groupOf = (g) => (selected.has(g.key) ? "Selected" : GROUPS[g.state]);
  const counts = {};
  for (const g of ordered) counts[groupOf(g)] = (counts[groupOf(g)] || 0) + 1;

  const filtered = f.confs.length || f.top25;
  let html = "", lastGroup;
  for (const g of ordered) {
    const group = groupOf(g);
    if (group !== lastGroup) {
      if (lastGroup) html += `</div></div>`;
      const open = !state.collapsedGroups.has(group);
      html += `<button class="group-label ${group.toLowerCase()}" data-group="${group}" aria-expanded="${open}">${group}<span class="n">${counts[group]}</span>${CHEVRON}</button>
        <div class="group-body ${open ? "" : "collapsed"}"><div class="group-clip">${filtered || admin.bulkAlways ? groupActions(group) : ""}`;
    }
    lastGroup = group;
    html += row(g);
  }
  if (lastGroup) html += `</div></div>`;
  lastListEmpty = !html;
  $("list").innerHTML = html || (state.loaded[tab] ? `<div class="empty">${filtered ? "No matching games." : "No games this week."}</div>` : spinner);
}

// Select all / Remove all atop a section, while Top 25 or a conference narrows the list (always, for the admin). A
// state's "Remove all" only shows while some of its games are picked (they sit under Selected).
const STATE_OF = { Live: "in", Upcoming: "pre", Final: "post" };
function groupActions(group) {
  const button = (action, label) => `<button type="button" data-bulk="${action}" data-group="${group}">${label}</button>`;
  if (group === "Selected") return `<div class="group-actions">${button("remove", "Remove all")}</div>`;
  return `<div class="group-actions">${button("add", "Select all")}${bulkGames(group, false).length ? button("remove", "Remove all") : ""}</div>`;
}

// The games a bulk button acts on, worked out from the games as they are now rather than when the list was drawn
// (it redraws only every LIST_REFRESH_MS, and a game can kick off or end in between). Within the current tab and
// filters: unpicked games of the section's state to add, picked ones to remove; Selected removes every picked game.
function bulkGames(group, add) {
  return listView().filter((g) => (group === "Selected" || g.state === STATE_OF[group]) && state.selected.has(g.key) !== add);
}

// One picker row, styled like a TV score bug: two stacked team lines, then the game status.
function row(g) {
  const final = g.state === "post", live = g.state === "in";
  const line = (t, other) => `<span class="bug-team ${final && +t.score < +other.score ? "lost" : ""}">
      ${logoImg(t)}${rankBadge(t)}<span class="abbr">${t.abbr}</span>${t.record ? `<span class="rec">${t.record}</span>` : ""}
      ${live && g.possession === t.id ? `<span class="poss">●</span>` : ""}
      <span class="pts ${leads(g, t, other) ? "lead" : ""}">${g.state === "pre" ? "" : t.score}</span></span>`;
  return `<label class="game ${live ? "live" : ""}"><input type="checkbox" data-key="${g.key}" ${state.selected.has(g.key) ? "checked" : ""}>
    <span class="bug">${line(g.away, g.home)}${line(g.home, g.away)}</span>
    <span class="bug-status">${statusLines(g)}</span>${bellButton(g, "row-bell")}
    <span class="pick" title="${state.selected.has(g.key) ? "Remove" : "Add"}" aria-hidden="true"></span></label>`;
}

function renderFilters() {
  const college = state.tab === "cfb";
  const f = state.filters[state.tab];
  const options = college ? collegeOptions(f.confs) : nflOptions();
  const menu = $("conf-menu");
  // Only rebuild when the choices change, so a refresh doesn't disturb the menu while it's open.
  const html = options.map((o) => o.group ? `<div class="group">${o.group}</div>`
    : `<label><input type="checkbox" value="${o.value}">${o.label}</label>`).join("");
  if (menu.dataset.html !== html) {
    menu.innerHTML = html;
    menu.dataset.html = html;
  }
  menu.querySelectorAll("input").forEach((box) => { box.checked = f.confs.includes(box.value); });
  const chosen = options.filter((o) => f.confs.includes(o.value)).map((o) => o.short ?? o.label);
  $("conf").textContent = !chosen.length ? "All conferences" : chosen.length <= 2 ? chosen.join(", ") : `${chosen.length} conferences`;
  $("conf").classList.toggle("active", chosen.length > 0);
  $("conf-clear").hidden = !f.confs.length;
  $("top25").hidden = !college;
  $("top25").setAttribute("aria-pressed", !!f.top25);
}

// Every named conference with a team playing this week, as { value, label }.
function collegeOptions(chosen) {
  const ids = new Set(state.games.cfb.flatMap((g) => [g.away.conf, g.home.conf]).filter((id) => confNames[id]));
  chosen.forEach((id) => ids.add(id));  // keep saved choices listed even before their names are learned
  return [...ids].sort((a, b) => (confNames[a] || "").localeCompare(confNames[b] || ""))
    .map((id) => ({ value: id, label: confNames[id] || "Conference " + id }));
}

// AFC and NFC, each a heading with "All AFC" and its four divisions underneath.
function nflOptions() {
  return ["AFC", "NFC"].flatMap((conf) => [
    { group: conf },
    { value: conf, label: `All ${conf}`, short: conf },
    ...Object.keys(NFL_DIVISIONS).filter((d) => d.startsWith(conf)).map((d) => ({ value: d, label: d })),
  ]);
}

function setConfMenu(open) {
  $("conf-menu").hidden = !open;
  $("conf").setAttribute("aria-expanded", open);
}

// FLIP animation: note where each row was, re-render, then slide every row from its old spot to its new one.
function renderListAnimated(movedKey) {
  const rowsByKey = () => new Map([...document.querySelectorAll("#list label.game")]
    .map((el) => [el.querySelector("input").dataset.key, el]));
  const before = new Map([...rowsByKey()].map(([key, el]) => [key, el.getBoundingClientRect().top]));
  renderList();
  for (const [key, el] of rowsByKey()) {
    const dy = before.has(key) ? before.get(key) - el.getBoundingClientRect().top : 0;
    if (!dy) continue;
    el.style.transform = `translateY(${dy}px)`;
    if (key === movedKey) {  // the moved row passes over the others, so give it a solid background
      el.style.zIndex = 1;
      el.style.background = "var(--panel)";
    }
    requestAnimationFrame(() => requestAnimationFrame(() => {
      el.style.transition = "transform .35s ease";
      el.style.transform = "";
      el.addEventListener("transitionend", () => { el.style.transition = el.style.zIndex = el.style.background = ""; }, { once: true });
    }));
  }
}

/**
 * @param {object} hooks
 * @param {() => void} hooks.onSelectionChanged  a game was picked or unpicked
 * @param {(key: string) => void} hooks.onHighlight  an already-picked row was clicked
 */
export function initPicker({ onSelectionChanged, onHighlight }) {
  spinner = $("list").innerHTML;
  const saveFiltersAndRender = () => { store.set("filters", state.filters); renderList(); };

  $("conf").addEventListener("click", () => setConfMenu($("conf-menu").hidden));
  $("conf-menu").addEventListener("change", () => {
    state.filters[state.tab].confs = [...$("conf-menu").querySelectorAll("input:checked")].map((box) => box.value);
    saveFiltersAndRender();
  });
  $("conf-clear").addEventListener("click", () => { state.filters[state.tab].confs = []; saveFiltersAndRender(); });
  // Close the checklist on a click anywhere outside it, or Escape.
  document.addEventListener("click", (e) => { if (!e.target.closest(".conf-wrap")) setConfMenu(false); });
  document.addEventListener("keydown", (e) => { if (e.key === "Escape") setConfMenu(false); });
  $("top25").addEventListener("click", () => {
    state.filters.cfb.top25 = !state.filters.cfb.top25;
    saveFiltersAndRender();
  });

  document.querySelector(".tabs").addEventListener("click", (e) => {
    const league = e.target.dataset?.league;
    if (!league) return;
    state.tab = league;
    store.set("tab", league);
    setConfMenu(false);
    renderList();
  });

  $("list").addEventListener("click", (e) => {
    if (onListBell(e)) return e.stopImmediatePropagation();
    const bulk = e.target.closest("[data-bulk]");
    if (!bulk) return;
    e.stopImmediatePropagation();
    const add = bulk.dataset.bulk === "add";
    bulkGames(bulk.dataset.group, add).forEach((g) => (add ? state.selected.add(g.key) : state.selected.delete(g.key)));
    saveSelected();
    renderList();
    onSelectionChanged();
  });

  // Section headers minimize their section. Toggle the existing element (no re-render) so the slide animates.
  $("list").addEventListener("click", (e) => {
    const header = e.target.closest(".group-label");
    if (!header) return;
    const group = header.dataset.group, open = state.collapsedGroups.has(group);
    open ? state.collapsedGroups.delete(group) : state.collapsedGroups.add(group);
    store.set("collapsedGroups", [...state.collapsedGroups]);
    header.setAttribute("aria-expanded", open);
    header.nextElementSibling.classList.toggle("collapsed", !open);
  });

  // Clicking an already-selected row highlights its card instead of unselecting it; only the ✓ circle unselects.
  $("list").addEventListener("click", (e) => {
    const input = e.target.closest("label.game")?.querySelector("input");
    // A label click also fires a second click on its checkbox, already toggled; that one must pass through untouched.
    if (e.target === input || !input?.checked || e.target.closest(".pick")) return;
    e.preventDefault();  // stop the label from toggling the checkbox
    onHighlight(input.dataset.key);
  });

  $("list").addEventListener("change", (e) => {
    const key = e.target.dataset.key;
    e.target.checked ? state.selected.add(key) : state.selected.delete(key);
    saveSelected();
    renderListAnimated(key);  // slide it into or out of the Selected group
    onSelectionChanged();
  });
}
