#!/bin/bash
# Deploys the site and its Worker, then starts the program on the new code right away (POST /api/wake), so belled
# games don't wait up to a minute for the every-minute nudge after a deploy. Open pages keep working throughout.
#
# Usage: scripts/deploy.sh
set -euo pipefail
cd "$(dirname "$0")/.."
npx wrangler deploy
for try in 1 2 3; do
  if curl -fsS --max-time 20 -X POST https://gametrackerlive.com/api/wake; then echo; exit 0; fi
  sleep 3
done
echo "Couldn't wake the program; the every-minute nudge will start it within a minute." >&2
