// MDS, the loud version, switched on by a ?mds link (js/settings.js): FOOTBALL IS HAPPENING scrolls up and down the
// screen's edges; the leading team gets a huge red arrow and its name in blue; a lead change sets off explosions and a
// banner; a tie gets a sad trombone; missiles hit the leaders' rows in the game list that are on screen; and an air horn
// goes off at a random moment once a minute. It always brings three fake live games whose scores swing every few
// seconds, alongside the visitor's own picks. Loaded only by that link. Sounds are synthesized, no audio files; browsers only allow sound after a
// click, so a button asks for one.

const DEMO_TICK_MS = 4000;
const MISSILE_EVERY_MS = 1800;
const MISSILE_FLIGHT_MS = 1100;
const HORN_EVERY_MS = 60_000;  // once in every minute, at a random moment in it

let app;  // { state, renderBoard, renderList, setExtraGames }
let canvas, ctx, soundBtn, styles, marquees, observer, missileTimer, hornTimer, frameId;
const particles = [];  // fire, smoke and sparks from explosions and missile trails
const missiles = [];
const leaders = new Map();  // game key -> "away" | "home" | "" (tied), as last drawn
let audio, master, muted = false;

export function start(hooks) {
  if (canvas) return;
  app = hooks;
  document.body.classList.add("mds");
  styles = document.createElement("link");
  styles.rel = "stylesheet";
  styles.href = new URL("/css/mds.css", location.href).href;
  document.head.append(styles);
  canvas = document.createElement("canvas");
  canvas.id = "mds-canvas";
  document.body.append(canvas);
  ctx = canvas.getContext("2d");
  addEventListener("resize", sizeCanvas);
  sizeCanvas();
  soundButton();
  // FOOTBALL IS HAPPENING, scrolling up the left edge and down the right (css/mds.css). Twice over, so the loop is seamless.
  const words = "🏈 FOOTBALL IS HAPPENING ".repeat(8);
  marquees = ["left", "right"].map((side) => {
    const el = document.createElement("div");
    el.className = `mds-marquee ${side}`;
    el.innerHTML = `<div>${words}${words}</div>`;
    document.body.append(el);
    return el;
  });
  observer = new MutationObserver(checkLeads);
  observer.observe(document.getElementById("board"), { childList: true });
  missileTimer = setInterval(launchMissile, MISSILE_EVERY_MS);
  setTimeout(launchMissile, 400);
  scheduleHorn(performance.now());
  frameId = requestAnimationFrame(frame);
  checkLeads();
  startDemo();
}

// --- Leads --------------------------------------------------------------------------------------------------------

// After every board render: the side whose score is underlined (.pts.lead, js/board.js) leads. A new leader gets the
// full treatment; a game that just got tied gets the trombone. The first look at a game blows it up just as hard,
// minus the banner.
function checkLeads() {
  if (!canvas) return;
  let trombone = false;
  for (const c of document.querySelectorAll("#board .card[data-key]")) {
    const side = c.querySelector(".team.away .pts.lead") ? "away" : c.querySelector(".team.home .pts.lead") ? "home" : "";
    const before = leaders.get(c.dataset.key);
    leaders.set(c.dataset.key, side);
    if (side === before) continue;
    if (side) {
      const name = c.querySelector(`.team.${side} .abbr`)?.textContent ?? "";
      setTimeout(() => celebrate(c.dataset.key, side, name, before !== undefined), Math.random() * 300);
    } else if (before) trombone = true;
  }
  if (trombone) sadTrombone();
}

function celebrate(key, side, name, isChange) {
  if (!canvas) return;
  const box = teamBox(key, side);
  if (!box) return;
  const x = box.left + box.width / 2, y = box.top + box.height / 2;
  for (let i = 0; i < 4; i++) setTimeout(() => explode(x + (Math.random() - .5) * 120, y + (Math.random() - .5) * 50, 1.4), i * 180);
  shake();
  if (isChange) banner(`${name} TAKES THE LEAD`);
}

const teamBox = (key, side) =>
  document.querySelector(`#board .card[data-key="${key}"] .team.${side}`)?.getBoundingClientRect();

// The game list's lines for leading teams that are on screen right now (the row's first line is the away team): inside
// the list's scrolling panel and the window, and not with the panel hidden or slid away.
function leaderRows() {
  const list = document.getElementById("list"), panel = list.closest("aside") ?? list;
  const area = panel.getBoundingClientRect();
  if (!list.checkVisibility() || area.right <= 0 || area.left >= innerWidth) return [];
  const top = Math.max(area.top, 0), bottom = Math.min(area.bottom, innerHeight);
  return [...list.querySelectorAll(".bug-team:has(.pts.lead)")].filter((el) => {
    const r = el.getBoundingClientRect();
    return r.height && r.top >= top && r.bottom <= bottom;
  });
}

// --- Missiles -----------------------------------------------------------------------------------------------------

function launchMissile() {
  const rows = leaderRows();
  if (!rows.length || document.hidden || !canvas) return;
  const row = rows[Math.floor(Math.random() * rows.length)];
  const key = row.closest("label.game").querySelector("input").dataset.key;
  const line = [...row.parentElement.children].indexOf(row);
  // From somewhere off the right or bottom edge, arcing in.
  const fromRight = Math.random() < .5;
  const from = fromRight ? { x: innerWidth + 40, y: Math.random() * innerHeight } : { x: Math.random() * innerWidth, y: innerHeight + 40 };
  missiles.push({ key, line, from, bend: (Math.random() - .5) * 600, born: performance.now() });
  whistle();
}

function missileTarget(m) {
  const row = document.querySelector(`#list input[data-key="${m.key}"]`)?.closest("label.game")?.querySelectorAll(".bug-team")[m.line];
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
      const label = document.querySelector(`#list input[data-key="${m.key}"]`)?.closest("label.game");
      label?.animate([{ transform: "translateX(-8px)" }, { transform: "translateX(8px)" }, { transform: "none" }], { duration: 160, iterations: 2 });
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

// --- Explosions ---------------------------------------------------------------------------------------------------

const WORDS = ["BOOM!", "KABOOM!", "BLAM!", "POW!", "WINNING!", "BANG!"];

function explode(x, y, scale = 1) {
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
  boomSound(scale);
}

function drawParticles(dt) {
  for (let i = particles.length - 1; i >= 0; i--) {
    const p = particles[i];
    p.age += dt;
    const k = p.age / p.life;
    if (k >= 1) { particles.splice(i, 1); continue; }
    if (p.vx != null) {
      p.x += p.vx * dt; p.y += p.vy * dt;
      p.vx *= .96; p.vy = p.vy * .96 + (p.kind === "smoke" ? -20 : 260) * dt;
    }
    ctx.globalAlpha = 1 - k;
    if (p.kind === "fire") {
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
      ctx.beginPath(); ctx.arc(p.x, p.y, p.size * k, 0, Math.PI * 2); ctx.stroke();
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

function circle(x, y, r) {
  ctx.beginPath(); ctx.arc(x, y, Math.max(0, r), 0, Math.PI * 2); ctx.fill();
}

// --- Arrows -------------------------------------------------------------------------------------------------------

// A huge red arrow beside every leading team on the board, coming in from the card's outer edge and jabbing at the team's
// logo (the away team is on the left, so its arrow points right). Drawn over everything, the game list included; only a
// team scrolled out of the board's view goes without.
function drawArrows(now) {
  const board = document.getElementById("board").getBoundingClientRect();
  for (const pts of document.querySelectorAll("#board .card .pts.lead")) {
    const team = pts.closest(".team"), r = (team.querySelector("img") ?? team).getBoundingClientRect();
    if (r.bottom < board.top || r.top > board.bottom) continue;
    const jab = Math.abs(Math.sin(now / 180)) * 18, away = team.classList.contains("away");
    arrow(away ? r.left - 4 - jab : r.right + 4 + jab, r.top + r.height / 2, away ? 1 : -1);
  }
  // Smaller ones in the game list, over the status column, jabbing left at each on-screen leader's score.
  for (const line of leaderRows()) {
    const r = line.querySelector(".pts").getBoundingClientRect();
    arrow(r.right + 3 + Math.abs(Math.sin(now / 150)) * 6, r.top + r.height / 2, -1, .55);
  }
}

// Its tip at (x, y), pointing right (dir 1) or left (dir -1).
function arrow(x, y, dir, size = 1.6) {
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(-dir * Math.PI / 2);  // drawn pointing down
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
  const dt = Math.min(.05, (now - last) / 1000);
  last = now;
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  drawArrows(now);
  moveMissiles(now);
  drawParticles(dt);
  frameId = requestAnimationFrame(frame);
}

function sizeCanvas() {
  const dpr = devicePixelRatio || 1;
  canvas.width = innerWidth * dpr;
  canvas.height = innerHeight * dpr;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
}

function banner(text) {
  const el = document.createElement("div");
  el.className = "mds-banner";
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

// --- Sound --------------------------------------------------------------------------------------------------------

// Browsers keep sound off until the page is clicked, so a big button asks for it; any click on the page also works.
function soundButton() {
  soundBtn = document.createElement("button");
  soundBtn.className = "mds-sound";
  soundBtn.textContent = "🔊 TAP FOR MAXIMUM HYPE";
  document.body.append(soundBtn);
  addEventListener("pointerdown", unlockElsewhere, true);
  // On the button itself, wait for the click: moving it on pointerdown would leave the pointer's release elsewhere.
  soundBtn.addEventListener("click", () => {
    if (!soundBtn.classList.contains("on")) { turnSoundOn().then(blastEveryone); return; }
    muted = !muted;
    master.gain.value = muted ? 0 : .9;
    soundBtn.textContent = muted ? "🔊 Unmute" : "🔇 Mute";
  });
}

// The sound button's payoff: the horn, and every leader on the board blown up.
function blastEveryone() {
  airHorn();
  for (const [key, side] of leaders) if (side) setTimeout(() => celebrate(key, side, "", false), Math.random() * 600);
}

function unlockElsewhere(e) {
  if (e.target !== soundBtn) turnSoundOn();
}

function turnSoundOn() {
  if (!audio) {
    audio = new AudioContext();
    const squash = audio.createDynamicsCompressor();  // loud without clipping
    master = audio.createGain();
    master.gain.value = .9;
    master.connect(squash).connect(audio.destination);
  }
  removeEventListener("pointerdown", unlockElsewhere, true);
  soundBtn.textContent = "🔇 Mute";
  soundBtn.classList.add("on");  // shrinks into the corner
  return audio.resume();
}

const ready = () => audio && audio.state === "running" && !muted;

// One air horn somewhere in the minute starting at slotStart, then the next minute's.
function scheduleHorn(slotStart) {
  const at = slotStart + Math.random() * HORN_EVERY_MS;
  hornTimer = setTimeout(() => {
    if (!document.hidden) airHorn();
    scheduleHorn(slotStart + HORN_EVERY_MS);
  }, Math.max(0, at - performance.now()));
}

// BWAA BWA BWA BWAAAAA, twice, the second time a step higher: a stack of detuned sawtooth voices through heavy
// distortion, each blast starting sharp and the long ones wobbling.
function airHorn() {
  if (!ready()) return;
  const t0 = audio.currentTime + .02;
  const shaper = audio.createWaveShaper();
  shaper.curve = Float32Array.from({ length: 2048 }, (_, i) => Math.tanh((i / 1024 - 1) * 9));
  const tone = audio.createBiquadFilter();
  tone.type = "peaking";  // a honky bump where horns hurt most
  tone.frequency.value = 2500;
  tone.gain.value = 9;
  const out = audio.createGain();
  out.gain.value = .5;
  shaper.connect(tone).connect(out).connect(master);
  const blasts = [[0, .3], [.36, .11], [.53, .11], [.7, 1]];
  for (const [round, lift] of [[0, 1], [1.85, 1.12]]) {
    for (const [at, len] of blasts) {
      const start = t0 + round + at, env = audio.createGain();
      env.gain.setValueAtTime(0, start);
      env.gain.linearRampToValueAtTime(1, start + .015);
      env.gain.setValueAtTime(1, start + len - .04);
      env.gain.linearRampToValueAtTime(0, start + len);
      env.connect(shaper);
      for (const f of [466, 470, 462, 233, 349, 699, 932]) {
        const o = audio.createOscillator();
        o.type = "sawtooth";
        o.frequency.setValueAtTime(f * lift * 1.06, start);
        o.frequency.exponentialRampToValueAtTime(f * lift, start + .07);
        if (len > .5) {  // the long blast wobbles
          const lfo = audio.createOscillator(), depth = audio.createGain();
          lfo.frequency.value = 7;
          depth.gain.value = f * lift * .012;
          lfo.connect(depth).connect(o.frequency);
          lfo.start(start);
          lfo.stop(start + len);
        }
        o.connect(env);
        o.start(start);
        o.stop(start + len + .02);
      }
    }
  }
}

// Filtered noise for the blast plus a falling low thump.
function boomSound(scale) {
  if (!ready()) return;
  const t0 = audio.currentTime, len = 1.2;
  const noise = audio.createBufferSource();
  noise.buffer = audio.createBuffer(1, audio.sampleRate * len, audio.sampleRate);
  noise.buffer.getChannelData(0).forEach((_, i, d) => { d[i] = Math.random() * 2 - 1; });
  const lp = audio.createBiquadFilter();
  lp.type = "lowpass";
  lp.frequency.setValueAtTime(2200, t0);
  lp.frequency.exponentialRampToValueAtTime(70, t0 + len);
  const g = audio.createGain();
  g.gain.setValueAtTime(Math.min(1, .6 * scale), t0);
  g.gain.exponentialRampToValueAtTime(.001, t0 + len);
  noise.connect(lp).connect(g).connect(master);
  noise.start(t0);
  const thump = audio.createOscillator(), tg = audio.createGain();
  thump.frequency.setValueAtTime(110, t0);
  thump.frequency.exponentialRampToValueAtTime(30, t0 + .5);
  tg.gain.setValueAtTime(.9, t0);
  tg.gain.exponentialRampToValueAtTime(.001, t0 + .6);
  thump.connect(tg).connect(master);
  thump.start(t0);
  thump.stop(t0 + .6);
}

// The falling whistle of an incoming missile.
function whistle() {
  if (!ready()) return;
  const t0 = audio.currentTime, len = MISSILE_FLIGHT_MS / 1000;
  const o = audio.createOscillator(), g = audio.createGain();
  o.frequency.setValueAtTime(1800, t0);
  o.frequency.exponentialRampToValueAtTime(500, t0 + len);
  g.gain.setValueAtTime(.08, t0);
  g.gain.linearRampToValueAtTime(.15, t0 + len * .9);
  g.gain.linearRampToValueAtTime(0, t0 + len);
  o.connect(g).connect(master);
  o.start(t0);
  o.stop(t0 + len);
}

// Wah wah wah waaah.
function sadTrombone() {
  if (!ready()) return;
  const t0 = audio.currentTime + .02;
  [[294, 0, .45], [277, .5, .45], [262, 1, .45], [247, 1.5, 1.3]].forEach(([f, at, len], i) => {
    const o = audio.createOscillator(), g = audio.createGain(), lp = audio.createBiquadFilter();
    o.type = "sawtooth";
    lp.type = "lowpass";
    lp.frequency.value = 900;
    o.frequency.setValueAtTime(f, t0 + at);
    if (i === 3) {  // the last note wobbles
      const lfo = audio.createOscillator(), depth = audio.createGain();
      lfo.frequency.value = 6;
      depth.gain.value = 6;
      lfo.connect(depth).connect(o.frequency);
      lfo.start(t0 + at);
      lfo.stop(t0 + at + len);
    }
    g.gain.setValueAtTime(0, t0 + at);
    g.gain.linearRampToValueAtTime(.3, t0 + at + .05);
    g.gain.linearRampToValueAtTime(0, t0 + at + len);
    o.connect(lp).connect(g).connect(master);
    o.start(t0 + at);
    o.stop(t0 + at + len);
  });
}

// --- Demo games ---------------------------------------------------------------------------------------------------

const logo = (id) => `https://a.espncdn.com/i/teamlogos/ncaa/500/${id}.png`;
// Every game starts with someone ahead, so the arrows and missiles start at once.
const team = (id, abbr, name, color, conf, rank, record, score) => ({ id, abbr, name, logo: logo(id), conf, color, score, rank, record });
const demo = [
  { away: team("84", "IU", "Indiana", "#990000", 5, 3, "6-0", "14"), home: team("158", "NEB", "Nebraska", "#e41c38", 5, 24, "4-2", "10") },
  { away: team("130", "MICH", "Michigan", "#00274c", 5, 12, "5-1", "3"), home: team("194", "OSU", "Ohio State", "#ce1141", 5, 1, "6-0", "7") },
  { away: team("251", "TEX", "Texas", "#bf5700", 8, 6, "5-1", "21"), home: team("201", "OU", "Oklahoma", "#841617", 8, 15, "4-2", "17") },
].map((g, i) => ({
  ...g, key: `cfb:mds-${i + 1}`, date: new Date(), state: "in", period: 2, secs: 600 + i * 200, network: "MDS+",
  yardLine: 50, distance: 10, possession: g.away.id, redZone: false, lastPlay: "Kickoff. Everyone is very calm.",
}));
const PLAYS = [
  [7, "TOUCHDOWN {t}!!! Absolutely nobody could have seen that coming."],
  [3, "{t} field goal is GOOD. Modest, tasteful, three points."],
  [7, "{t} pick-six. The stadium is on fire (figuratively)."],
  [2, "SAFETY! {t} gets two points the hard way."],
];

// Picked (but never saved: js/state.js saveSelected) so they show on the board, and added to every poll's games.
function startDemo() {
  // Into the list right away, so the demo works even while ESPN can't be reached.
  app.state.games.cfb.push(...demo);
  demo.forEach((g) => app.state.selected.add(g.key));
  app.setExtraGames((league) => (league === "cfb" ? demo : []));
  syncDemo();
  setTimeout(demoPlay, 1200);  // the first lead change right away
  setInterval(demoPlay, DEMO_TICK_MS);
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
