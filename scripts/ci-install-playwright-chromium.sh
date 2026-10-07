#!/usr/bin/env bash
# Installs Playwright's Chromium and its system packages on a CI runner, failing fast and
# retrying instead of hanging (#470). On 2026-10-07 the plain install hung four times,
# once inside `apt-get update` against an Ubuntu mirror, and each time the job sat until its
# 25-minute limit before any test ran; a re-run passed. The install normally takes ~35s.
#
# Usage: scripts/ci-install-playwright-chromium.sh [attempts] [seconds-per-attempt]
set -euo pipefail

ATTEMPTS="${1:-3}"
ATTEMPT_SECONDS="${2:-180}"

# A stalled mirror otherwise blocks apt indefinitely. Make each connection give up and
# retry on its own, so a slow mirror still has a chance inside one attempt.
sudo tee /etc/apt/apt.conf.d/80-ci-network-timeouts > /dev/null <<'APT'
Acquire::Retries "3";
Acquire::http::Timeout "30";
Acquire::https::Timeout "30";
APT

cd "$(dirname "$0")/../clients/poolmaster"

for ATTEMPT in $(seq 1 "$ATTEMPTS"); do
  echo "Installing Playwright Chromium (attempt $ATTEMPT of $ATTEMPTS, ${ATTEMPT_SECONDS}s limit)"
  # --kill-after in case a child ignores the TERM.
  if timeout --kill-after=15 "$ATTEMPT_SECONDS" npx playwright install --with-deps chromium; then
    exit 0
  fi
  echo "::warning::Playwright Chromium install attempt $ATTEMPT failed or timed out"
  # A dpkg run killed mid-install leaves the next apt-get refusing to start.
  sudo dpkg --configure -a || true
  sleep 10
done

echo "::error::Playwright Chromium install failed after $ATTEMPTS attempts"
exit 1
