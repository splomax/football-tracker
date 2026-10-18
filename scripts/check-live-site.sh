#!/bin/bash
# Checks the deployed site: its pages load, the Worker's own source and tooling files aren't served, www. redirects to
# the bare domain, and the admin API refuses a wrong password.
#
# Usage: scripts/check-live-site.sh [ip]
# Pass one of the domain's IPs (dig +short gametrackerlive.com) to skip this machine's DNS cache, e.g. right after
# the domain first goes live, when the Mac may still remember it not existing.
set -u
SITE=gametrackerlive.com
OPTS=(--max-time 20 -s)
if [ $# -ge 1 ]; then OPTS+=(--resolve "$SITE:443:$1" --resolve "www.$SITE:443:$1"); fi

status() { curl "${OPTS[@]}" -o /dev/null -w '%{http_code}' "$@"; }

echo "should be 200 (the site):"
for p in / /js/main.js /images/og.png; do printf "  %-20s %s\n" "$p" "$(status "https://$SITE$p")"; done
echo "should be 404 (not part of the site):"
for p in /worker/admin.js /worker/handler.js /package.json /wrangler.toml /tests/app.spec.js; do
  printf "  %-20s %s\n" "$p" "$(status "https://$SITE$p")"
done
echo "should be 401 (admin API without a valid login):"
printf "  %-20s %s\n" "/api/admin.js" "$(status "https://$SITE/api/admin.js")"
printf "  %-20s %s\n" "/api/login (wrong)" "$(status -X POST -H 'Authorization: Bearer wrong' "https://$SITE/api/login")"
echo "www. should be 301 to the bare domain, keeping the query:"
curl "${OPTS[@]}" -o /dev/null -w "  %{http_code} -> %{redirect_url}\n" "https://www.$SITE/?game=cfb:1"
echo "link-preview address:"
curl "${OPTS[@]}" "https://$SITE/" | grep -o 'og:url" content="[^"]*' | sed 's/^/  /'
