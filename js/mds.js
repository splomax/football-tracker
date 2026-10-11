// MDS, the loud version, switched on by a ?mds link (js/settings.js): FOOTBALL IS HAPPENING scrolls up and down the
// screen's edges; the leading team gets a huge red arrow and its name in blue; a lead change sets off explosions and a
// banner; every so often a missile flies in from the lower right corner at a leader; banners shout things like HOLY
// SHIT every so often; and fireworks go up about every half minute. It always brings three fake live games whose scores
// swing every few seconds, alongside the visitor's own picks. Loaded only by that link; switching MDS off in the gear
// menu stops it (stop()) until the next ?mds visit. No sound.

// It starts calm and builds: for the first WARM_UP_MS, fake scores come at the slower pace.
const WARM_UP_MS = 30_000;
const DEMO_TICK_MS = [7000, 4000];        // [warming up, full speed]
const MISSILE_FLIGHT_MS = 1100;
// Shouted across the screen now and then, like a lead change's banner but about nothing.
const SHOUTS = [
  "HOLY SHIT", "CALL THE COPS", "UNBELIEVABLE SCENES", "THEY'RE PLAYING FOOTBALL", "LOOK AT THE NUMBERS",
  "BOTH TEAMS WANT TO WIN", "THE CLOCK IS GOING DOWN", "THE BALL IS OVAL", "SOMEONE HAS THE BALL", "THIS CHANGES EVERYTHING",
  "ENHANCE", "ZOOM IN", "HACKING THE MAINFRAME", "WE DON'T REALLY KNOW WHAT LIFE IS", "PETTING IS JUST RANDOMLY PETTING",
  "I AM SELLING YOUR DATA",
];
const SHOUT_MS = [6000, 14000];  // the gap before the next one, at random between these

let app;  // { state, renderBoard, renderList, setExtraGames, firstPoll } from js/main.js
let startedAt;
const pace = ([warmingUp, fullSpeed]) => (performance.now() - startedAt < WARM_UP_MS ? warmingUp : fullSpeed);
let canvas, ctx, observer;
// The screen's size, from the page rather than innerWidth/innerHeight, which Chrome's phone simulator can get wrong.
const screenW = () => document.documentElement.clientWidth, screenH = () => document.documentElement.clientHeight;
// False once stop() has run: every timer still pending checks it and does nothing.
let running = false;
const particles = [];  // fire, smoke and sparks from explosions and missile trails
const missiles = [];
const leaders = new Map();  // game key -> "away" | "home" | "" (tied), as last drawn

export function start(hooks) {
  app = hooks;
  running = true;
  document.body.classList.add("mds");
  const styles = document.createElement("link");
  styles.rel = "stylesheet";
  styles.href = new URL("/css/mds.css", location.href).href;
  document.head.append(styles);
  canvas = document.createElement("canvas");
  canvas.id = "mds-canvas";
  document.body.append(canvas);
  ctx = canvas.getContext("2d");
  sizeCanvas();
  // FOOTBALL IS HAPPENING, scrolling up the left edge and down the right (css/mds.css). Twice over, so the loop is seamless.
  const words = "🏈 FOOTBALL IS HAPPENING ".repeat(8);
  for (const side of ["left", "right"]) {
    const el = document.createElement("div");
    el.className = `mds-marquee ${side}`;
    el.innerHTML = `<div>${words}${words}</div>`;
    document.body.append(el);
  }
  observer = new MutationObserver(checkLeads);
  observer.observe(document.getElementById("board"), { childList: true });
  // The opening, one thing at a time: a small pop on each leader in turn (checkLeads), the first missile at 8s, the
  // first fake score at 10s (startDemo), the first shout at 18s.
  startedAt = performance.now();
  setTimeout(shout, 18_000);
  setTimeout(fireworks, 8000);
  scheduleMissile(true);
  requestAnimationFrame(frame);
  checkLeads();
  startDemo();
}

// Back to the normal page, for good (it comes back only with a reload): everything drawn goes, the timers stop and the
// fake games leave the list and the board.
export function stop() {
  running = false;
  observer.disconnect();
  document.body.classList.remove("mds");
  for (const el of document.querySelectorAll("#mds-canvas, .mds-marquee, .mds-banner, link[href$='/css/mds.css']")) el.remove();
  const keys = new Set(demo.map((g) => g.key));
  app.setExtraGames(() => []);
  app.state.games.cfb = app.state.games.cfb.filter((g) => !keys.has(g.key));
  keys.forEach((k) => app.state.selected.delete(k));
  app.renderList();
  app.renderBoard();
}

// --- Leads --------------------------------------------------------------------------------------------------------

// After every board render: the side whose score is underlined (.pts.lead, js/board.js) leads. A new leader gets the
// full treatment. The first look at a game gets a small pop.
function checkLeads() {
  let firstLooks = 0;
  for (const c of document.querySelectorAll("#board .card[data-key]")) {
    const side = c.querySelector(".team.away .pts.lead") ? "away" : c.querySelector(".team.home .pts.lead") ? "home" : "";
    const before = leaders.get(c.dataset.key);
    leaders.set(c.dataset.key, side);
    if (side === before) continue;
    if (side) {
      const name = c.querySelector(`.team.${side} .abbr`)?.textContent ?? "";
      // Lead changes go off together, full size; first looks get a small pop each, two seconds apart.
      const first = before === undefined;
      setTimeout(() => celebrate(c.dataset.key, side, name, !first, first), first ? firstLooks++ * 2000 : Math.random() * 300);
    }
  }
}

function celebrate(key, side, name, isChange, small = false) {
  if (!running) return;
  const box = teamBox(key, side);
  if (!box) return;
  const x = box.left + box.width / 2, y = box.top + box.height / 2;
  if (small) return explode(x, y, .8);
  for (let i = 0; i < 4; i++) setTimeout(() => explode(x + (Math.random() - .5) * 120, y + (Math.random() - .5) * 50, 1.4), i * 180);
  shake();
  if (isChange) banner(`${name} TAKES THE LEAD`);
}

const teamBox = (key, side) =>
  document.querySelector(`#board .card[data-key="${key}"] .team.${side}`)?.getBoundingClientRect();

// The game list's lines for leading teams that are on screen right now (the row's first line is the away team): inside
// the list's scrolling panel (the side panel on a computer, the slide-in drawer on a phone) and the window, clear of what's
// pinned at its top and bottom, and not with the panel hidden or slid away.
function leaderRows() {
  const list = document.getElementById("list");
  let panel = list;
  while (panel.parentElement && !/auto|scroll/.test(getComputedStyle(panel).overflowY)) panel = panel.parentElement;
  const area = panel.getBoundingClientRect();
  if (!list.checkVisibility() || area.right <= 0 || area.left >= screenW()) return [];
  // Not under the panel's pinned header (the tabs and filters) or, on a phone, its Done bar.
  const head = panel.querySelector(".list-head")?.getBoundingClientRect(), foot = panel.querySelector(".drawer-foot");
  const top = Math.max(area.top, 0, head?.bottom ?? 0);
  const bottom = Math.min(area.bottom, screenH(), foot?.checkVisibility() ? foot.getBoundingClientRect().top : Infinity);
  return [...list.querySelectorAll(".bug-team:has(.pts.lead)")].filter((el) => {
    const r = el.getBoundingClientRect();
    return r.height && r.top >= top && r.bottom <= bottom;
  });
}

// --- Missiles -----------------------------------------------------------------------------------------------------

// Something to shoot: a random on-screen leader's line in the game list ({ key, line }), or with the list closed a
// leading team on the board ({ card, side }); null when there's neither.
const pick = (list) => list[Math.floor(Math.random() * list.length)];
function pickTarget() {
  const rows = leaderRows();
  if (rows.length) {
    const row = pick(rows);
    return { key: row.closest("label.game").querySelector("input").dataset.key, line: [...row.parentElement.children].indexOf(row) };
  }
  const leads = [...document.querySelectorAll("#board .card .pts.lead")].filter((p) => {
    const r = p.getBoundingClientRect();
    return r.bottom > 0 && r.top < screenH();
  });
  if (!leads.length) return null;
  const pts = pick(leads);
  return { card: pts.closest(".card").dataset.key, side: pts.closest(".team").classList.contains("away") ? "away" : "home" };
}

// From `from` at the target, arcing in.
function launchMissile(from, target) {
  if (!target || document.hidden || !missileTarget(target)) return;
  missiles.push({ ...target, from, bend: (Math.random() - .5) * 400, born: performance.now() });
}

// The element a target stands for: a game-list row, or a card.
const targetElement = (m) => (m.card ? document.querySelector(`#board .card[data-key="${m.card}"]`)
  : document.querySelector(`#list input[data-key="${m.key}"]`)?.closest("label.game"));

function missileTarget(m) {
  if (m.card) {
    const r = teamBox(m.card, m.side);
    return r?.height ? { x: r.left + r.width / 2, y: r.top + r.height / 2 } : null;
  }
  const row = targetElement(m)?.querySelectorAll(".bug-team")[m.line];
  const r = row?.getBoundingClientRect();
  return r?.height ? { x: r.left + 40, y: r.top + r.height / 2 } : null;
}

function moveMissiles(now) {
  for (let i = missiles.length - 1; i >= 0; i--) {
    const m = missiles[i], to = missileTarget(m);
    const t = Math.min(1, (now - m.born) / MISSILE_FLIGHT_MS);
    if (!to) { missiles.splice(i, 1); continue; }
    if (t === 1) {
      missiles.splice(i, 1);
      explode(to.x, to.y, .9);
      targetElement(m)?.animate([{ transform: "translateX(-8px)" }, { transform: "translateX(8px)" }, { transform: "none" }], { duration: 160, iterations: 2 });
      continue;
    }
    // Quadratic curve from the launch point to the row, bent sideways by m.bend.
    const c = { x: (m.from.x + to.x) / 2 + m.bend, y: (m.from.y + to.y) / 2 - Math.abs(m.bend) / 2 };
    const at = (u) => ({
      x: (1 - u) ** 2 * m.from.x + 2 * (1 - u) * u * c.x + u * u * to.x,
      y: (1 - u) ** 2 * m.from.y + 2 * (1 - u) * u * c.y + u * u * to.y,
    });
    const p = at(t), ahead = at(Math.min(1, t + .01));
    drawMissile(p.x, p.y, Math.atan2(ahead.y - p.y, ahead.x - p.x));
    particles.push({ x: p.x, y: p.y, vx: (Math.random() - .5) * 30, vy: (Math.random() - .5) * 30, life: .6, age: 0, size: 6, kind: "smoke" });
  }
}

function drawMissile(x, y, angle) {
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(angle);
  ctx.fillStyle = Math.random() < .5 ? "#ffb000" : "#ff4d00";  // flame
  ctx.beginPath(); ctx.moveTo(-16, -3); ctx.lineTo(-28 - Math.random() * 10, 0); ctx.lineTo(-16, 3); ctx.fill();
  ctx.fillStyle = "#c9ced6";  // body
  ctx.fillRect(-16, -4, 26, 8);
  ctx.fillStyle = "#e01b24";  // nose and fins
  ctx.beginPath(); ctx.moveTo(10, -4); ctx.lineTo(18, 0); ctx.lineTo(10, 4); ctx.fill();
  ctx.beginPath(); ctx.moveTo(-16, -4); ctx.lineTo(-20, -9); ctx.lineTo(-10, -4); ctx.fill();
  ctx.beginPath(); ctx.moveTo(-16, 4); ctx.lineTo(-20, 9); ctx.lineTo(-10, 4); ctx.fill();
  ctx.restore();
}

// --- Missile launches --------------------------------------------------------------------------------------------

// Every 8 to 14 seconds a missile flies in from the lower right corner (just inside the right-hand scroller) at a leader:
// in the game list, or on the board when the list is closed.
const MISSILE_GAP_MS = [8000, 14000];
const EDGE = 34;  // the side scrollers' width (css/mds.css)

function scheduleMissile(first = false) {
  const gap = first ? 8000 : MISSILE_GAP_MS[0] + Math.random() * (MISSILE_GAP_MS[1] - MISSILE_GAP_MS[0]);
  setTimeout(() => {
    if (!running) return;
    launchMissile({ x: screenW() - EDGE - 10, y: screenH() + 10 }, pickTarget());
    scheduleMissile();
  }, gap);
}

// --- Explosions ---------------------------------------------------------------------------------------------------

const WORDS = ["BOOM!", "KABOOM!", "BLAM!", "POW!", "WINNING!", "BANG!"];

function explode(x, y, scale = 1) {
  if (!running) return;
  for (let i = 0; i < 70 * scale; i++) {
    const a = Math.random() * Math.PI * 2, v = (80 + Math.random() * 420) * scale;
    particles.push({ x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v - 60, life: .5 + Math.random() * .7, age: 0,
      size: (3 + Math.random() * 7) * scale, kind: Math.random() < .25 ? "spark" : "fire" });
  }
  for (let i = 0; i < 14 * scale; i++) {
    particles.push({ x: x + (Math.random() - .5) * 40, y: y + (Math.random() - .5) * 30, vx: (Math.random() - .5) * 60,
      vy: -30 - Math.random() * 60, life: 1.2 + Math.random(), age: 0, size: 14 * scale, kind: "smoke" });
  }
  particles.push({ x, y, life: .45, age: 0, size: 160 * scale, kind: "ring" });
  particles.push({ x, y: y - 30 * scale, life: .9, age: 0, size: 30 * scale, kind: "word", text: WORDS[Math.floor(Math.random() * WORDS.length)] });
}

function drawParticles(dt) {
  for (let i = particles.length - 1; i >= 0; i--) {
    const p = particles[i];
    p.age += dt;
    const k = p.age / p.life;
    if (k >= 1) {
      particles.splice(i, 1);
      if (p.kind === "rocket") burst(p.x, p.y);
      continue;
    }
    if (p.kind === "rocket" || p.kind === "star") {  // no air drag to speak of, gentler gravity for the stars
      p.x += p.vx * dt; p.y += p.vy * dt;
      p.vy += (p.kind === "star" ? 70 : 160) * dt;
      p.vx *= .99;
    } else if (p.vx != null) {
      p.x += p.vx * dt; p.y += p.vy * dt;
      p.vx *= .96; p.vy = p.vy * .96 + (p.kind === "smoke" ? -20 : 260) * dt;
    }
    ctx.globalAlpha = 1 - k;
    if (p.kind === "rocket") {
      ctx.globalAlpha = 1;
      ctx.fillStyle = "#fff6c0";
      circle(p.x, p.y, 2.5);
      particles.push({ x: p.x, y: p.y, vx: (Math.random() - .5) * 20, vy: 30, life: .5, age: 0, kind: "spark" });
    } else if (p.kind === "star") {
      ctx.globalAlpha = k > .7 && Math.random() < .5 ? 0 : 1 - k * k;  // twinkles out
      ctx.fillStyle = p.color;
      ctx.shadowColor = p.color;
      ctx.shadowBlur = 8;
      circle(p.x, p.y, p.size);
      ctx.shadowBlur = 0;
    } else if (p.kind === "fire") {
      ctx.fillStyle = k < .3 ? "#fff3b0" : k < .6 ? "#ff9d00" : "#e0301e";
      circle(p.x, p.y, p.size * (1 - k * .5));
    } else if (p.kind === "spark") {
      ctx.fillStyle = "#ffe066";
      ctx.fillRect(p.x, p.y, 3, 3);
    } else if (p.kind === "smoke") {
      ctx.fillStyle = "rgba(90, 90, 90, .5)";
      circle(p.x, p.y, p.size * (1 + k * 2));
    } else if (p.kind === "ring") {
      ctx.strokeStyle = "#fff";
      ctx.lineWidth = 6 * (1 - k);
      ctx.beginPath(); ctx.arc(p.x, p.y, Math.max(0, p.size * k), 0, Math.PI * 2); ctx.stroke();
    } else if (p.kind === "word") {
      const s = p.size * (1 + Math.min(k * 4, .6));
      ctx.font = `900 ${s}px Impact, "Arial Black", sans-serif`;
      ctx.textAlign = "center";
      ctx.lineWidth = 5;
      ctx.strokeStyle = "#000";
      ctx.strokeText(p.text, p.x, p.y - k * 30);
      ctx.fillStyle = "#ffdd00";
      ctx.fillText(p.text, p.x, p.y - k * 30);
    }
  }
  ctx.globalAlpha = 1;
}

// --- Fireworks ---------------------------------------------------------------------------------------------------

// The first at 8 seconds, then one about every half minute; now and then two or three go up together.
const FIREWORK_MS = [24_000, 36_000];
const FIREWORK_COLORS = ["#ff3b3b", "#ffd23f", "#3bff6f", "#3bc8ff", "#c63bff", "#ff8a3b", "#ffffff"];

function fireworks() {
  if (!running) return;
  if (!document.hidden) {
    const count = Math.random() < .3 ? 2 + Math.floor(Math.random() * 2) : 1;
    for (let i = 0; i < count; i++) setTimeout(launchRocket, i * (150 + Math.random() * 350));
  }
  setTimeout(fireworks, FIREWORK_MS[0] + Math.random() * (FIREWORK_MS[1] - FIREWORK_MS[0]));
}

// From the bottom edge, bursting somewhere in the top half of the window.
function launchRocket() {
  if (!running) return;
  const x = screenW() * (.15 + Math.random() * .7), rise = screenH() * (.5 + Math.random() * .3), life = 1.1;
  particles.push({ x, y: screenH() + 10, vx: (Math.random() - .5) * 80, vy: -(rise / life + 160 * life / 2), life, age: 0, kind: "rocket" });
}

function burst(x, y) {
  const color = () => FIREWORK_COLORS[Math.floor(Math.random() * FIREWORK_COLORS.length)];
  const main = color(), second = color();
  for (let i = 0; i < 110; i++) {
    const a = (i / 110) * Math.PI * 2 + Math.random() * .05, v = 150 + Math.random() * 170;
    particles.push({ x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v, life: 1.4 + Math.random() * .8, age: 0,
      size: 2 + Math.random() * 1.5, kind: "star", color: Math.random() < .75 ? main : second });
  }
  particles.push({ x, y, life: .35, age: 0, size: 120, kind: "ring" });
}

function circle(x, y, r) {
  ctx.beginPath(); ctx.arc(x, y, Math.max(0, r), 0, Math.PI * 2); ctx.fill();
}

// --- Arrows -------------------------------------------------------------------------------------------------------

// A huge red arrow beside every leading team on the board, coming in from the card's outer edge and jabbing at the team's
// logo (the away team is on the left, so its arrow points right). Drawn over everything, the game list included; only a
// team scrolled out of the board's view goes without.
// On a phone, where the cards are narrow, the arrows come down from above at the team's score instead (matches css/mobile.css).
const phone = () => matchMedia("(max-width: 700px)").matches;

function drawArrows(now) {
  const board = document.getElementById("board").getBoundingClientRect(), down = phone();
  // On a phone the open game list covers the board, so the board's arrows wait until it closes.
  const covered = down && !document.querySelector("aside")?.classList.contains("collapsed");
  for (const pts of covered ? [] : document.querySelectorAll("#board .card .pts.lead")) {
    const team = pts.closest(".team"), r = (team.querySelector("img") ?? team).getBoundingClientRect();
    if (r.bottom < board.top || r.top > board.bottom) continue;
    const jab = Math.abs(Math.sin(now / 180)) * (down ? 10 : 18), away = team.classList.contains("away");
    if (down) {
      const p = pts.getBoundingClientRect();
      arrow(p.left + p.width / 2, p.top - 10 - jab, Math.PI / 2, .9);
    }
    else arrow(away ? r.left - 4 - jab : r.right + 4 + jab, r.top + r.height / 2, away ? 0 : Math.PI);
  }
  // Smaller ones in the game list at each on-screen leader's score: from its right, or on a phone from its left.
  for (const line of leaderRows()) {
    const r = line.querySelector(".pts").getBoundingClientRect(), jab = Math.abs(Math.sin(now / 150)) * 6;
    if (down) arrow(r.left - 3 - jab, r.top + r.height / 2, 0, .45);
    else arrow(r.right + 3 + jab, r.top + r.height / 2, Math.PI, .55);
  }
}

// Its tip at (x, y), pointing along angle (0 is right, as on screen).
function arrow(x, y, angle, size = 1.6) {
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(angle - Math.PI / 2);  // drawn pointing down
  ctx.scale(size, size);
  ctx.beginPath();
  ctx.moveTo(0, 0); ctx.lineTo(-22, -24); ctx.lineTo(-9, -24); ctx.lineTo(-9, -54);
  ctx.lineTo(9, -54); ctx.lineTo(9, -24); ctx.lineTo(22, -24); ctx.closePath();
  ctx.fillStyle = "#ff1a1a";
  ctx.shadowColor = "rgba(255, 0, 0, .8)";
  ctx.shadowBlur = 16;
  ctx.fill();
  ctx.shadowBlur = 0;
  ctx.lineWidth = 3;
  ctx.strokeStyle = "#fff";
  ctx.stroke();
  ctx.restore();
}

// --- Frame loop, banner, shake ------------------------------------------------------------------------------------

let last = performance.now();
function frame(now) {
  if (!running) return;
  // A frame's timestamp can be a touch earlier than the last time we looked; never step time backwards.
  const dt = Math.max(0, Math.min(.05, (now - last) / 1000));
  last = now;
  sizeCanvas();
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  drawArrows(now);
  moveMissiles(now);
  drawParticles(dt);
  requestAnimationFrame(frame);
}

// The canvas's pixels match its box on screen, checked every frame: in Chrome's phone simulator innerHeight can start
// out several times the screen's height with no resize to follow, which squashed everything drawn towards the top.
function sizeCanvas() {
  const dpr = devicePixelRatio || 1, w = Math.round(canvas.clientWidth * dpr), h = Math.round(canvas.clientHeight * dpr);
  if (canvas.width === w && canvas.height === h) return;
  canvas.width = w;
  canvas.height = h;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
}

// A random shout, then the next one a random while later.
function shout() {
  if (!running) return;
  // Somewhere off the middle, so it doesn't land on a lead change's banner.
  if (!document.hidden) banner(SHOUTS[Math.floor(Math.random() * SHOUTS.length)], `${[22, 62][Math.floor(Math.random() * 2)] + Math.random() * 10}%`);
  setTimeout(shout, SHOUT_MS[0] + Math.random() * (SHOUT_MS[1] - SHOUT_MS[0]));
}

// Banners take turns: each starts as the one before is nearly gone (BANNER_MS in css/mds.css), so two overlap only for a
// moment and every one can be read. One that would wait more than a few seconds is dropped.
const BANNER_MS = 2200, BANNER_OVERLAP_MS = 300;
let bannerFree = 0;
function banner(text, top) {
  const now = performance.now(), wait = Math.max(0, bannerFree - now);
  if (wait > 4000) return;
  bannerFree = now + wait + BANNER_MS - BANNER_OVERLAP_MS;
  setTimeout(() => showBanner(text, top), wait);
}

function showBanner(text, top) {
  if (!running) return;
  const el = document.createElement("div");
  el.className = "mds-banner";
  if (top) el.style.top = top;
  el.textContent = `💥 ${text} 💥`;
  document.body.append(el);
  el.addEventListener("animationend", () => el.remove());
}

function shake() {
  for (const el of [document.querySelector("main"), document.querySelector("header")]) {
    el?.animate([0, 1, 2, 3, 4, 5].map((i) => ({ transform: i === 5 ? "none" : `translate(${(Math.random() - .5) * 30}px, ${(Math.random() - .5) * 20}px) rotate(${(Math.random() - .5) * 2}deg)` })),
      { duration: 450 });
  }
}

// --- Demo games ---------------------------------------------------------------------------------------------------

const logo = (id) => `https://a.espncdn.com/i/teamlogos/ncaa/500/${id}.png`;
// Every game starts with someone ahead, so the arrows and missiles start at once.
const team = (id, abbr, name, color, conf, rank, record, score) => ({ id, abbr, name, logo: logo(id), conf, color, score, rank, record });
const demo = [
  { away: team("154", "WAKE", "Wake Forest", "#9e7e38", 1, undefined, "3-3", "14"), home: team("150", "DUKE", "Duke", "#013088", 1, undefined, "4-2", "10") },
  { away: team("130", "MICH", "Michigan", "#00274c", 5, 12, "5-1", "3"), home: team("194", "OSU", "Ohio State", "#ce1141", 5, 1, "6-0", "7") },
  { away: team("251", "TEX", "Texas", "#bf5700", 8, 6, "5-1", "21"), home: team("201", "OU", "Oklahoma", "#841617", 8, 15, "4-2", "17") },
].map((g, i) => ({
  ...g, key: `cfb:mds-${i + 1}`, date: new Date(), state: "in", period: 2, secs: 600 + i * 200, network: "MDS+",
  yardLine: 50, distance: 10, possession: g.away.id, redZone: false, lastPlay: "Kickoff. Everyone is very calm.",
}));
const MAX_DEMO_SCORE = 45;
const BELIEVABLE = [0, 3, 7, 10, 13, 14, 17, 20, 21, 24, 27, 28];
const PLAYS = [
  [7, "TOUCHDOWN {t}!!! Absolutely nobody could have seen that coming."],
  [3, "{t} field goal is GOOD. Modest, tasteful, three points."],
  [7, "{t} pick-six. The stadium is on fire (figuratively)."],
  [2, "SAFETY! {t} gets two points the hard way."],
];

// Picked (but never saved: js/state.js saveSelected) so they show on the board, and added to every poll's games. They
// wait for ESPN's first answer, so they don't jump in ahead of the real games; if ESPN can't be reached, they come anyway.
async function startDemo() {
  await app.firstPoll;
  if (!running) return;
  app.state.games.cfb.push(...demo);
  demo.forEach((g) => app.state.selected.add(g.key));
  app.setExtraGames((league) => (league === "cfb" ? demo : []));
  syncDemo();
  const plays = () => {
    if (!running) return;
    demoPlay();
    setTimeout(plays, pace(DEMO_TICK_MS));
  };
  setTimeout(plays, 10_000);
  app.renderList();
  app.renderBoard();
}

function demoPlay() {
  const g = demo[Math.floor(Math.random() * demo.length)];
  // The trailing team scores more often, so leads keep changing.
  const away = +g.away.score, home = +g.home.score;
  const trailer = away < home ? g.away : home < away ? g.home : null;
  const scorer = trailer && Math.random() < .75 ? trailer : Math.random() < .5 ? g.away : g.home;
  const [pts, text] = PLAYS[Math.floor(Math.random() * PLAYS.length)];
  scorer.score = String(+scorer.score + pts);
  g.lastPlay = text.replace("{t}", scorer.name);
  for (const d of demo) d.secs = Math.max(1, d.secs - 37);
  // Past a believable score, start the game over from one that is, a few minutes back on the clock.
  if (+scorer.score > MAX_DEMO_SCORE) {
    g.away.score = String(pick(BELIEVABLE));
    g.home.score = String(pick(BELIEVABLE));
    g.secs = 600 + Math.floor(Math.random() * 300);
    g.lastPlay = "Officials have reviewed the score. It was too much. Resetting.";
  }
  syncDemo();
  app.renderList();
  app.renderBoard();
}

// Clock, ball and down text that look about right.
function syncDemo() {
  for (const g of demo) {
    g.clock = `${Math.floor(g.secs / 60)}:${String(g.secs % 60).padStart(2, "0")}`;
    g.detail = `${g.clock} - 2nd`;
    g.possession = Math.random() < .5 ? g.away.id : g.home.id;
    g.yardLine = 15 + Math.floor(Math.random() * 70);
    const side = g.yardLine > 50 ? g.away : g.home;  // yardLine counts from the home goal line
    g.ddText = `${["1st", "2nd", "3rd", "4th"][Math.floor(Math.random() * 4)]} & ${g.distance} at ${side.abbr} ${g.yardLine > 50 ? 100 - g.yardLine : g.yardLine}`;
    const toGoal = g.possession === g.away.id ? g.yardLine : 100 - g.yardLine;
    g.redZone = toGoal <= 20;
  }
}
