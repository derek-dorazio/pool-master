#!/usr/bin/env sh
set -eu
node scripts/check-no-mocked-api.mjs "$@"
