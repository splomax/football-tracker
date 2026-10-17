// Lists code that looks unused, for review by hand (it only reports; nothing is changed):
//   - exports no other file mentions (and whether only tests mention them)
//   - top-level functions and constants their own file never uses again
//   - CSS classes and ids no JS or HTML mentions
//   - CSS custom properties (--x) never read with var(), and @keyframes no animation uses
//   - storage keys that are written but never read
// It's text matching, not a parser: names built at run time (like `${group.toLowerCase()}`) can show up as false
// alarms, so check each hit before deleting anything.
//
// Usage: node scripts/find-unused.js

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

// Exports: used if another app file mentions the name; "tests only" if only tests do.
for (const f of jsFiles) {
  const names = [...code[f].matchAll(/export\s+(?:async\s+)?(?:function\*?|const|let|class)\s+([\w$]+)/g)].map((m) => m[1]);
  for (const m of code[f].matchAll(/export\s*\{([^}]*)\}/g)) names.push(...m[1].split(",").map((n) => n.trim().split(/\s+as\s+/).pop()).filter(Boolean));
  for (const name of names) {
    const elsewhere = appFiles.filter((g) => g !== f && count(code[g], name));
    if (elsewhere.length) continue;
    const inTests = testFiles.some((t) => count(code[t], name));
    const inside = count(code[f], name) > 1;
    add("Exports no other app file uses", `${f}: ${name}${inTests ? " (tests use it)" : ""}${inside ? " (used inside its own file; the export may be unneeded)" : ""}`);
  }
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
for (const prop of new Set([...allCss.matchAll(/(--[\w-]+)\s*:/g)].map((m) => m[1]))) {
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
