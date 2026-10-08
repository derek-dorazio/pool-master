#!/usr/bin/env bash
# Installs Playwright's Chromium and its system packages on a CI runner, failing fast and
# retrying instead of hanging (#470). On 2026-10-07 the plain install hung four times,
# once inside `apt-get update` against an Ubuntu mirror, and each time the job sat until its
# 25-minute limit before any test ran; a re-run passed. The install normally takes ~35s.
#
# On 2026-10-08 a mirror served packages at ~100 KB/s: the first attempt hit its limit, and
# both retries failed at once on the dpkg lock, because `timeout` stops npx but not the
# apt-get it started under sudo. Retries now wait for that apt-get to finish first.
#
# Usage: scripts/ci-install-playwright-chromium.sh [attempts] [seconds-per-attempt] [total-seconds]
# total-seconds bounds the whole script, waits included; keep it under the CI step's limit.
set -euo pipefail

ATTEMPTS="${1:-3}"
ATTEMPT_SECONDS="${2:-180}"
TOTAL_SECONDS="${3:-660}"
DEADLINE=$((SECONDS + TOTAL_SECONDS))

# A stalled mirror otherwise blocks apt indefinitely. Make each connection give up and
# retry on its own, so a slow mirror still has a chance inside one attempt.
sudo tee /etc/apt/apt.conf.d/80-ci-network-timeouts > /dev/null <<'APT'
Acquire::Retries "3";
Acquire::http::Timeout "30";
Acquire::https::Timeout "30";
APT

apt_busy() {
  pgrep -x apt-get > /dev/null || pgrep -x dpkg > /dev/null
}

cd "$(dirname "$0")/../clients/poolmaster"

# Seconds kept back from each attempt for timeout's --kill-after, so an attempt never
# runs past the deadline.
KILL_RESERVE=25
# Worst case for the cleanup between attempts: sleep 5 plus dpkg's 30s limit and 5s kill-after.
CLEANUP_SECONDS=45
# An attempt shorter than this cannot finish a slow-mirror install; skip it.
MIN_ATTEMPT_SECONDS=30

for ATTEMPT in $(seq 1 "$ATTEMPTS"); do
  REMAINING=$((DEADLINE - SECONDS - KILL_RESERVE))
  if [ "$REMAINING" -lt "$MIN_ATTEMPT_SECONDS" ]; then
    echo "::warning::No time left for attempt $ATTEMPT"
    break
  fi
  LIMIT=$((REMAINING < ATTEMPT_SECONDS ? REMAINING : ATTEMPT_SECONDS))
  echo "Installing Playwright Chromium (attempt $ATTEMPT of $ATTEMPTS, ${LIMIT}s limit)"
  # --kill-after in case a child ignores the TERM.
  if timeout --kill-after=15 "$LIMIT" npx playwright install --with-deps chromium; then
    exit 0
  fi
  echo "::warning::Playwright Chromium install attempt $ATTEMPT failed or timed out"
  [ "$ATTEMPT" -lt "$ATTEMPTS" ] || break
  # The apt-get left running under sudo still holds the dpkg lock, so the next attempt
  # would fail at once. Let it finish while time allows; its downloads still count.
  NEEDED=$((KILL_RESERVE + MIN_ATTEMPT_SECONDS + CLEANUP_SECONDS))
  while apt_busy && [ $((DEADLINE - SECONDS)) -gt "$NEEDED" ]; do
    sleep 5
  done
  if [ $((DEADLINE - SECONDS)) -lt "$NEEDED" ]; then
    echo "::warning::No time left for attempt $((ATTEMPT + 1))"
    break
  fi
  if apt_busy; then
    echo "::warning::apt-get or dpkg is still running; stopping it before the next attempt"
    sudo pkill -x apt-get || true
    sudo pkill -x dpkg || true
    sleep 5
  fi
  # A dpkg run killed mid-install leaves the next apt-get refusing to start. Its postinst
  # scripts can run long, so bound it like everything else here.
  timeout --kill-after=5 30 sudo dpkg --configure -a || true
done

echo "::error::Playwright Chromium install did not succeed within ${TOTAL_SECONDS}s"
exit 1
