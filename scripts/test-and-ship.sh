#!/usr/bin/env bash
# Runs the Playwright suite (RUNS times, default 1, to catch flaky tests) and the Worker tests, and only if every run
# passes, commits the given files and pushes (which deploys through CI).
#
# Usage: scripts/test-and-ship.sh "commit message" file1 file2 ...    (RUNS=2 scripts/test-and-ship.sh ... for two runs)
#        scripts/test-and-ship.sh --test-only                         (just run the tests)
set -uo pipefail
cd "$(dirname "$0")/.."
pkill -f "http.server 4173" 2>/dev/null  # a leftover dev server would be reused by Playwright
for i in $(seq "${RUNS:-1}"); do
  out=$(npx playwright test 2>&1)
  echo "$out" | grep -E "✘|[0-9]+ (passed|failed|flaky)"
  if echo "$out" | grep -qE "[0-9]+ (failed|flaky)"; then echo "Playwright run $i failed: not committing"; exit 1; fi
done
if ! npm run test:worker >/dev/null 2>&1; then echo "Worker tests failed: not committing"; exit 1; fi
echo "All tests passed"
[ "${1:-}" = "--test-only" ] && exit 0
msg="$1"; shift
git add -- "$@" && git commit -qm "$msg" && git push -q && git log --oneline -1
