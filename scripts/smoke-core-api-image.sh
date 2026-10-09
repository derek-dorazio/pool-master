#!/usr/bin/env bash
# #180 — build the core-api image, run it against a real Postgres, and check that /health
# answers and /version reports the version baked in at build time. This is the only check
# that proves version-info.json travels with the image and that the container starts from
# `node dist/index.js` with nothing but its runtime environment.
#
# Usage: scripts/smoke-core-api-image.sh <service-version> <database-url>
# The database must be reachable from the host network; migrations are applied with the
# image's own migrate script first, as the QA migrate task does.
set -euo pipefail

VERSION="${1:?service version required}"
DATABASE_URL="${2:?database url required}"
IMAGE="poolmaster-core-api:smoke"
CONTAINER="poolmaster-core-api-smoke"
PORT=3000

docker build \
  --file infrastructure/docker/Dockerfile.core-api \
  --build-arg SERVICE_VERSION="$VERSION" \
  --build-arg SERVICE_GIT_SHA="$VERSION" \
  --tag "$IMAGE" \
  .

docker run --rm --network host -e DATABASE_URL="$DATABASE_URL" "$IMAGE" \
  node scripts/run-migrations.mjs

cleanup() {
  docker logs "$CONTAINER" > core-api-smoke.log 2>&1 || true
  docker rm -f "$CONTAINER" > /dev/null 2>&1 || true
}
trap cleanup EXIT

docker run --detach --name "$CONTAINER" --network host \
  -e DATABASE_URL="$DATABASE_URL" \
  -e POOLMASTER_ENVIRONMENT=ci \
  -e JWT_SECRET="$(openssl rand -hex 32)" \
  -e PORT="$PORT" \
  -e AUTO_START_SCHEDULER=false \
  "$IMAGE" > /dev/null

for _ in $(seq 1 30); do
  if curl -fs "http://localhost:${PORT}/health" > /dev/null; then
    break
  fi
  sleep 1
done
curl -fsS "http://localhost:${PORT}/health"
echo

REPORTED=$(curl -fsS "http://localhost:${PORT}/version" | tee /dev/stderr | jq -r '.service.version')
echo
if [ "$REPORTED" != "$VERSION" ]; then
  echo "::error::/version reported service version '${REPORTED}', expected '${VERSION}'"
  docker logs "$CONTAINER" || true
  exit 1
fi
echo "core-api image serves /health and reports version ${VERSION}"
