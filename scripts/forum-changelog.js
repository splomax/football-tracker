// Builds the BB code changelog posted to the forum, in two steps.
//
//   node scripts/forum-changelog.js commits [--since YYYY-MM-DD]
//     Lists the commits to write notes from, minus housekeeping (only TODO, tests, scripts, CI or docs touched) and
//     reverted pairs. [UI] marks a commit that touched the page (css/, index.html, js/). Without --since, starts after
//     the "through"
//     commit of the newest changelogs/*.json.
//
//   node scripts/forum-changelog.js render changelogs/<date>.json
//     Shoots the logo (00-logo.png, centered above the title) and the screenshots the notes name and prints the BB code (also saved next to the screenshots, in a temp
//     dir printed at the end) for uploading the images to imgur by hand. Needs npm start (and webkit for :phone).
//
// The notes file is written by hand from the commits list, as high-level features, not commit messages:
//   { "title": "...", "since": "2026-10-10", "through": "<commit>",
//     "features": [{ "title": "...", "text": "...", "shots": ["board-list", "board-list:phone", "board-image"] }],
//     "fixes": ["..."], "comingSoon": [{ "title": "...", "text": "...", "shots": [...] }] }
// A shot is a state from scripts/screenshot-matrix.js (desktop unless :phone), board-image for Save board as image, or
// one of the site's own pictures by path (e.g. images/apple-touch-icon.png).

const fs = require("fs");
const os = require("os");
const path = require("path");
const { execFileSync } = require("child_process");

const ROOT = path.join(__dirname, "..");
const NOTES_DIR = path.join(ROOT, "changelogs");
const git = (...args) => execFileSync("git", args, { cwd: ROOT, encoding: "utf8" });

const HOUSEKEEPING = /^(TODO\.md|CLAUDE\.md|README\.md|scripts\/|tests\/|\.github\/|changelogs\/|playwright\.config\.js|package(-lock)?\.json)/;
const UI = /^(css\/|index\.html|js\/)/;

function commits(since) {
  const range = since ? ["--since", `${since} 00:00`] : [`${lastThrough()}..HEAD`];
  const log = git("log", "--reverse", "--no-merges", "--format=%x00%h%x09%ad%x09%s", "--date=format:%a %m-%d", "--name-only", ...range);
  const all = log.split("\0").filter(Boolean).map((block) => {
    const [head, ...files] = block.trim().split("\n");
    const [hash, date, subject] = head.split("\t");
    return { hash, date, subject, files: files.filter(Boolean) };
  });
  const reverted = new Set(all.map((c) => c.subject.match(/^Revert "(.*)"$/)?.[1]).filter(Boolean));
  let dropped = 0;
  for (const c of all) {
    if (reverted.has(c.subject) || /^Revert "/.test(c.subject) || c.files.every((f) => HOUSEKEEPING.test(f))) { dropped++; continue; }
    console.log(`${c.hash} ${c.date} ${c.files.some((f) => UI.test(f)) ? "[UI]" : "    "} ${c.subject}`);
  }
  console.log(`\n(${dropped} housekeeping or reverted commits left out; HEAD is ${git("rev-parse", "--short", "HEAD").trim()})`);
}

function lastThrough() {
  const files = fs.existsSync(NOTES_DIR) ? fs.readdirSync(NOTES_DIR).filter((f) => f.endsWith(".json")).sort() : [];
  if (!files.length) throw new Error("no earlier changelog in changelogs/; pass --since YYYY-MM-DD");
  return JSON.parse(fs.readFileSync(path.join(NOTES_DIR, files.at(-1)), "utf8")).through;
}

async function render(notesFile) {
  const notes = JSON.parse(fs.readFileSync(notesFile, "utf8"));
  const out = path.join(os.tmpdir(), `forum-changelog-${path.basename(notesFile, ".json")}`);
  fs.rmSync(out, { recursive: true, force: true });
  fs.mkdirSync(out, { recursive: true });
  const { STATES, shoot } = require("./screenshot-matrix");
  let n = 0;

  async function images(shots = []) {
    const tags = [];
    for (const shot of shots) {
      const [name, device = "desktop"] = shot.split(":");
      const file = `${String(++n).padStart(2, "0")}-${path.basename(name, ".png")}${device === "phone" ? "-phone" : ""}.png`;
      if (name.startsWith("images/")) {
        fs.copyFileSync(path.join(ROOT, name), path.join(out, file));  // a picture from the site as it is, e.g. the app icon
      } else if (name === "board-image") {
        const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "board-image-"));
        execFileSync("node", [path.join(__dirname, "preview-images.js"), tmp], { stdio: "inherit" });
        fs.renameSync(path.join(tmp, "board.png"), path.join(out, file));
      } else if (!STATES[name]) {
        throw new Error(`unknown shot ${name}; add it to STATES in scripts/screenshot-matrix.js`);
      } else if (!(await shoot(device, name, STATES[name], path.join(out, file)))) {
        throw new Error(`couldn't shoot ${shot}`);
      }
      tags.push(`[img]${file}[/img]`);
    }
    return tags.length ? "\n" + tags.join("\n") : "";
  }
  async function items(list) {
    let s = "";
    for (const f of list) s += `[*][b]${f.title}[/b]: ${f.text}${await images(f.shots)}\n`;
    return s;
  }

  await logo(path.join(out, "00-logo.png"));
  let bb = `[center][img]00-logo.png[/img][/center]\n[size=5][b]${notes.title}[/b][/size]\n\n`;
  if (notes.features?.length) bb += `[b]New[/b]\n[list]\n${await items(notes.features)}[/list]\n\n`;
  if (notes.fixes?.length) bb += `[b]Fixes[/b]\n[list]\n${notes.fixes.map((f) => `[*]${f}\n`).join("")}[/list]\n\n`;
  if (notes.comingSoon?.length) {
    bb += `[b]Coming soon[/b] [i](still being tested; not part of the site yet)[/i]\n[list]\n${await items(notes.comingSoon)}[/list]\n`;
  }
  fs.writeFileSync(path.join(out, "changelog.bbcode"), bb);
  console.log(bb);
  console.log(`Screenshots and changelog.bbcode in ${out}\nReplace each [img]file[/img] with its imgur link.`);
}

// The header's football (a jack-o'-lantern in October, as on the site) and wordmark, at twice size for sharp edges.
async function logo(file) {
  const { chromium } = require("@playwright/test");
  const browser = await chromium.launch({ channel: "chrome" });
  try {
    const page = await browser.newPage({ viewport: { width: 1300, height: 900 }, deviceScaleFactor: 2, colorScheme: "dark" });
    await page.route("https://site.api.espn.com/**", (route) => route.abort());
    await page.goto("http://localhost:4173/");
    await page.waitForSelector("header h1");
    await page.waitForTimeout(500);  // web fonts
    const [a, b] = [await page.locator("#logo").boundingBox(), await page.locator("header h1").boundingBox()];
    const pad = 12, x = Math.min(a.x, b.x) - pad, y = Math.min(a.y, b.y) - pad;
    await page.screenshot({ path: file, clip: { x, y,
      width: Math.max(a.x + a.width, b.x + b.width) + pad - x, height: Math.max(a.y + a.height, b.y + b.height) + pad - y } });
  } finally {
    await browser.close();
  }
}

const [cmd, arg, value] = process.argv.slice(2);
if (cmd === "commits") commits(arg === "--since" ? value : undefined);
else if (cmd === "render" && arg) render(arg).catch((e) => { console.error(e.message); process.exit(1); });
else console.error("usage: forum-changelog.js commits [--since YYYY-MM-DD] | render changelogs/<date>.json");
