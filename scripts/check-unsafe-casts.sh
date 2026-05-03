#!/usr/bin/env sh
set -eu
node scripts/check-unsafe-casts.mjs "$@"
