#!/usr/bin/env bash
#
# Run a single `gh` command under the derek-dorazio-agent-codex[bot] App
# identity. Mints a fresh installation token, exports it as GH_TOKEN for the
# duration of this script, and execs `gh` with whatever args were passed.
#
# Usage:
#   ./scripts/gh-as-codex.sh pr review 13 --approve --body-file findings.md
#   ./scripts/gh-as-codex.sh api /installation/repositories
#
# Why a wrapper: keeps the App identity scoped to a single command. Don't
# leave GH_TOKEN exported in the caller's shell — when implementer commits
# (git push, gh pr create) inherit an active App token, the resulting PR
# is authored by the bot instead of by the human, which breaks the
# multi-pass review flow (a bot can't review its own PR).
#
# See docs/CI-AND-QUALITY-GATES.md "GitHub App setup runbook" for the
# identity model and rules/workflow-rules.md §6 for the multi-pass review
# protocol that this wrapper supports.

set -euo pipefail

KEY_PATH="$HOME/.config/github-apps/derek-dorazio-agent-codex.private-key.pem"

if [[ ! -f "$KEY_PATH" ]]; then
  echo "Error: codex App private key not found at $KEY_PATH" >&2
  echo "Generate one via the App settings page and save it there before using this wrapper." >&2
  exit 2
fi

export GH_APP_ID=3589131
export GH_APP_INSTALLATION_ID=129218629
export GH_APP_PRIVATE_KEY_PATH="$KEY_PATH"
export GH_TOKEN
GH_TOKEN=$(node "$(dirname "$0")/get-app-installation-token.mjs")

exec gh "$@"
