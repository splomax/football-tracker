// IN PROGRESS: not trusted yet. After every run, check each hit by hand and look for misses, then note what it got
// wrong in "Track record" below and fix the script, until a few runs in a row come back clean.
//
// Lists code that looks unused, for review by hand (it only reports; nothing is changed):
//   - exports no other file imports (by path, so same-named functions in different files can't hide each other), and
//     whether only tests import them
//   - what js/admin.js hands the admin module (app.*) that it never uses, and admin hooks no page code calls
//   - top-level functions and constants their own file never uses again
//   - CSS classes and ids no JS or HTML mentions
//   - CSS custom properties (--x) never read with var(), and @keyframes no animation uses
//   - storage keys that are written but never read
// It's text matching, not a parser: names built at run time (like `${group.toLowerCase()}`) can show up as false
// alarms, so check each hit before deleting anything.
//
// Usage: node scripts/find-unused.js
//
// Track record:
//   2026-10-17, run 1: 7 hits, 1 worth acting on. False alarm: --grass/--grass-alt (js/field.js builds the name,
//     `var(--grass${…})`). Missed: allGames handed to the admin module but unused there; alerts.js's periodName used
//     only by tests (hidden by format.js's own periodName). Fixed: imports are now matched by path, names built with
//     `${` are treated as prefixes, and the admin hooks are checked.
//   2026-10-17, run 2 (after removing the allGames hook and scoreLine's export): 6 hits, all correct; none to act on
//     (periodName, TOKEN_DAYS and VISITS_URL stay exported for their tests; the hidden* keys are a deliberate cleanup).
//     The new admin checks caught a planted allGames hand-off and a planted unused hook. No misses found by hand.
//   2026-10-18, run 3 (after deleting the loud ?mds and its extraGames/firstPoll plumbing): same 5 hits as run 2, all
//     correct; it reported no leftovers from the removal, and a grep for mds, MDS_LINK, extraGames and firstPoll found none.

const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..");
const read = (f) => fs.readFileSync(path.join(ROOT, f), "utf8");
const list = (dir, ext) => fs.readdirSync(path.join(ROOT, dir)).filter((f) => f.endsWith(ext) && !f.endsWith(".test.js")).map((f) => `${dir}/${f}`);

const jsFiles = [...list("js", ".js"), ...list("worker", ".js")];
const testFiles = ["tests/app.spec.js", "tests/fixtures.js", ...fs.readdirSync(path.join(ROOT, "worker")).filter((f) => f.endsWith(".test.js")).map((f) => `worker/${f}`)];
const cssFiles = list("css", ".css");
const src = Object.fromEntries([...jsFiles, ...cssFiles, "index.html", ...testFiles].map((f) => [f, read(f)]));
// Comments would make names look used, so match against the code with them removed.
const stripJs = (s) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:"'`\\])\/\/.*$/gm, "$1");
const stripCss = (s) => s.replace(/\/\*[\s\S]*?\*\//g, "");
const stripHtml = (s) => s.replace(/<!--[\s\S]*?-->/g, "");
const code = Object.fromEntries(Object.entries(src).map(([f, s]) => [f, f.endsWith(".css") ? stripCss(s) : f.endsWith(".html") ? stripHtml(s) : stripJs(s)]));

const escape = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const count = (text, name, flags = "g") => (text.match(new RegExp(`(?<![\\w$-])${escape(name)}(?![\\w$-])`, flags)) || []).length;
const appFiles = [...jsFiles, "index.html"];
const report = {};
const add = (section, line) => (report[section] ??= []).push(line);

// Imports, by file: static `import { a, b as c } from "./x.js"`, and dynamic `import("./x.js")`, where any `.name`
// in the importing file counts (m.saveBoardImage()).
const resolve = (from, spec) => path.posix.normalize(path.posix.join(path.posix.dirname(from), spec));
function importsOf(f) {
  const used = new Map();  // resolved file -> Set of names (or "*" for a dynamic import's .props)
  const note = (file, name) => (used.get(file) ?? used.set(file, new Set()).get(file)).add(name);
  for (const m of code[f].matchAll(/import\s*\{([^}]*)\}\s*from\s*["'](\.[^"']+)["']/g)) {
    for (const n of m[1].split(",").map((x) => x.trim().split(/\s+as\s+/)[0]).filter(Boolean)) note(resolve(f, m[2]), n);
  }
  for (const m of code[f].matchAll(/import\(\s*["'](\.[^"']+)["']\s*\)/g)) {
    for (const p of code[f].matchAll(/\.([\w$]+)\s*\(/g)) note(resolve(f, m[1]), p[1]);
  }
  return used;
}
const importers = (files) => {
  const all = new Map();
  for (const f of files) for (const [file, names] of importsOf(f)) for (const n of names) (all.get(file) ?? all.set(file, new Set()).get(file)).add(n);
  return all;
};
const appImports = importers(appFiles), testImports = importers(testFiles);

// Exports: used if another app file imports them from this file; "tests only" if only tests do.
for (const f of jsFiles) {
  const names = [...code[f].matchAll(/export\s+(?:async\s+)?(?:function\*?|const|let|class)\s+([\w$]+)/g)].map((m) => m[1]);
  for (const m of code[f].matchAll(/export\s*\{([^}]*)\}/g)) names.push(...m[1].split(",").map((n) => n.trim().split(/\s+as\s+/).pop()).filter(Boolean));
  for (const name of names) {
    if (appImports.get(f)?.has(name)) continue;
    if (f === "worker/admin.js" && name === "install") continue;  // loaded from a blob by js/admin.js, not imported
    if (f === "worker/index.js" || f === "worker/handler.js" && name === "handle") continue;  // the Worker's entry point
    const inTests = testImports.get(f)?.has(name);
    const inside = count(code[f], name) > 1;
    add("Exports no other app file imports", `${f}: ${name}${inTests ? " (tests import it)" : ""}${inside ? " (used inside its own file; the export may be unneeded)" : ""}`);
  }
}

// The admin module (worker/admin.js, loaded from a blob, so it can't import): what js/admin.js hands it as app.*
// that it never uses, and the hooks its install() returns that no page code calls.
{
  const handed = /install\(\{([^}]*)\}\)/.exec(code["js/admin.js"])?.[1].split(",").map((n) => n.trim().split(":")[0].trim()).filter(Boolean) ?? [];
  for (const name of handed) if (!count(code["worker/admin.js"], `app.${name}`)) add("Handed to the admin module but unused there", `js/admin.js install(): ${name}`);
  const ret = /return\s*\{([\s\S]*?)\n  \};/.exec(code["worker/admin.js"].slice(code["worker/admin.js"].indexOf("export function install")))?.[1] ?? "";
  const hooks = [...ret.matchAll(/^\s{4}([\w$]+)\s*(?:[:,(]|$)/gm)].map((m) => m[1]);
  const consumers = ["js/board.js", "js/picker.js", "js/admin.js"].map((f) => code[f]).join("\n");
  for (const h of hooks) if (!count(consumers, h)) add("Admin hooks no page code calls", `worker/admin.js install() returns ${h}`);
}

// Top-level declarations used nowhere else in their own file (or anywhere, for worker/admin.js's install hooks).
for (const f of jsFiles) {
  for (const m of code[f].matchAll(/^(?:async\s+)?(?:function\*?\s+([\w$]+)|(?:const|let|var)\s+([\w$]+)\s*=)/gm)) {
    const name = m[1] || m[2];
    if (count(code[f], name) === 1 && !appFiles.some((g) => g !== f && count(code[g], name))) add("Top-level names used only where defined", `${f}: ${name}`);
  }
}

// CSS selectors: class and id names, from the selector part of each rule only (not values like #fff or .5em).
const jsAndHtml = appFiles.map((f) => code[f]).join("\n");
const selectors = new Map();  // name -> { kind, files }
for (const f of cssFiles) {
  for (const m of code[f].matchAll(/([^{}]+)\{/g)) {
    const sel = m[1].trim();
    if (sel.startsWith("@")) continue;  // @media / @container / @keyframes preludes
    for (const s of sel.matchAll(/([.#])(-?[a-zA-Z_][\w-]*)/g)) {
      const key = s[1] + s[2];
      if (!selectors.has(key)) selectors.set(key, new Set());
      selectors.get(key).add(f);
    }
  }
}
for (const [key, files] of selectors) {
  const name = key.slice(1);
  if (count(jsAndHtml, name)) continue;
  const caseless = count(jsAndHtml, name, "gi") ? " (appears with other capitalization; maybe built at run time)" : "";
  add("CSS classes/ids no JS or HTML mentions", `${key} in ${[...files].join(", ")}${caseless}`);
}

// Custom properties and keyframes.
const allCss = cssFiles.map((f) => code[f]).join("\n");
const everything = allCss + "\n" + jsAndHtml;
// A name built in a template (`var(--grass${…})`) counts as a prefix: every property starting with it is read.
const builtPrefixes = [...everything.matchAll(/var\(\s*(--[\w-]*)\$\{/g)].map((m) => m[1]);
for (const prop of new Set([...allCss.matchAll(/(--[\w-]+)\s*:/g)].map((m) => m[1]))) {
  if (builtPrefixes.some((p) => prop.startsWith(p))) continue;
  if (!new RegExp(`var\\(\\s*${escape(prop)}[\\s,)]`).test(everything) && !count(jsAndHtml, prop)) add("CSS custom properties never read", prop);
}
for (const m of allCss.matchAll(/@keyframes\s+([\w-]+)/g)) {
  const uses = (everything.match(new RegExp(`(?<![\\w-])${escape(m[1])}(?![\\w-])`, "g")) || []).length;
  if (uses < 2) add("@keyframes no animation uses", m[1]);
}

// Storage keys: store.get/set (js/store.js) and app.store.get/set in the admin module.
const keys = { get: new Set(), set: new Set() };
for (const f of jsFiles) for (const m of code[f].matchAll(/store\.(get|set)\(\s*["']([\w-]+)["']/g)) keys[m[1]].add(m[2]);
for (const k of keys.set) if (!keys.get.has(k)) add("Storage keys written but never read", `${k}${/hidden|adminKey/.test(k) ? " (may be a deliberate cleanup of an old key)" : ""}`);

const sections = Object.entries(report);
if (!sections.length) console.log("Nothing looks unused.");
for (const [title, lines] of sections) {
  console.log(`\n${title} (${lines.length}):`);
  for (const l of lines) console.log(`  ${l}`);
}
