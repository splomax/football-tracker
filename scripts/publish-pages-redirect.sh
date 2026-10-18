#!/bin/bash
# Publishes the gh-pages branch: the old GitHub Pages address (yawyawfootbaw.github.io/football-tracker) now only
# forwards to gametrackerlive.com, keeping the path, the query (?game=, ?admin) and the hash. GitHub Pages serves this
# branch; the real site deploys from main to Cloudflare.
#
# Usage: scripts/publish-pages-redirect.sh   (re-run only if the redirect page itself needs to change)
set -euo pipefail
REMOTE=$(git -C "$(dirname "$0")/.." remote get-url origin)
WORK=$(mktemp -d)
trap 'rm -rf "$WORK"' EXIT
cd "$WORK"
git init -q -b gh-pages
cat > index.html <<'HTML'
<!doctype html>
<!-- Game Tracker Live moved to https://gametrackerlive.com. This branch (gh-pages) is all GitHub Pages serves now: every
     old address lands here (404.html is the same page) and is forwarded with its path, query and hash kept.
     Built by scripts/publish-pages-redirect.sh on main. -->
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Game Tracker Live has moved</title>
<meta name="robots" content="noindex">
<link rel="canonical" href="https://gametrackerlive.com/">
<script>
  const path = location.pathname.replace(/^\/football-tracker/, "").replace(/\/index\.html$/, "/") || "/";
  location.replace("https://gametrackerlive.com" + path + location.search + location.hash);
</script>
<meta http-equiv="refresh" content="0; url=https://gametrackerlive.com/">
</head>
<body style="font: 16px/1.5 -apple-system, sans-serif; background: #0f1115; color: #e8eaed; padding: 24px">
Game Tracker Live has moved to <a style="color: #4c8dff" href="https://gametrackerlive.com/">gametrackerlive.com</a>.
</body>
</html>
HTML
cp index.html 404.html
touch .nojekyll
git add -A
git -c user.name="$(git -C "$OLDPWD" config user.name)" -c user.email="$(git -C "$OLDPWD" config user.email)" \
  commit -q -m "GitHub Pages only forwards to gametrackerlive.com, keeping the path, query and hash"
git push -q --force "$REMOTE" gh-pages
echo "pushed gh-pages to $REMOTE"
