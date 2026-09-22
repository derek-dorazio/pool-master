# Plan 132 — Review Flow Simplification

**Tracking issue:** none — this plan was executed before the tracker migration (`830443d`, `a7bae4c`, `a287d85`), so no issue was ever opened for it.

> **This plan should be deleted** (ADR-0002). Its durable content is already codified:
> `rules/workflow-rules.md` §6 carries the review and merge loop, and
> `rules/review-triggers.md` carries the disclosure list. #139 owns that cleanup. This plan is the
narrative companion; task state lives in the tracker.

## Purpose

Remove the multi-pass bot review flow and replace the knowledge it carried with
implementer disclosure.

`rules/workflow-rules.md §6` defines six numbered review passes across two GitHub App
identities. That design assumed two agent runtimes and model coding quality that made an
independent second agent read worth its ceremony. Codex is leaving, and the tradeoff has
shifted. What replaces it is not "less review" — the repo owner reads every PR and
triggers every merge — but a much smaller apparatus around that read.

## Governing Principles

- **Mechanical enforcement beats prose.** CI gates become the primary automated signal.
- **Disclose what a scanner cannot detect.** The implementer knows why it made a change;
  a reviewer reading a file list has to infer it.
- **Delete on ship, don't archive** (ADR-0002).

## Triggering Findings

**The review apparatus costs more than it returns.** Six numbered passes, two GitHub App
identities, an installation-token minting script, two `gh-as-*` shims, a CI marker
scanner, and roughly 300 lines of `workflow-rules.md` exist to produce an independent
read of each diff.

**Pass 2 becomes unsatisfiable without Codex.** GitHub blocks `gh pr review --approve`
from the identity that authored the PR. The flow satisfies
`required_approving_review_count: 1` by having each runtime approve the other's work.
With one runtime that path closes, and no bot can approve.

**Sage is documented but unwired.** `personas/sage.md` defines Pass 3, but no wrapper
exists in `.claude/agents/` or `.codex/agents/`. The workflow documents a gate that
cannot run.

**Archie's Pass 4 shape does not match its wiring.** Archie is a skill (main-thread,
shares the implementer's context); Pass 4 specifies an isolated runtime under a separate
identity.

**Stale references.** The `§6` header examples cite "Claude Sonnet 4.6", not a released
model identifier.

## Key Decisions

### 1. Remove the multi-pass bot review flow

**What goes:**

- Passes 1 through 6 and the numbered-pass structure.
- The GitHub App identity model — both Apps, `scripts/get-app-installation-token.mjs`,
  `scripts/gh-as-claude.sh`, `scripts/gh-as-codex.sh`, the `GH_APP_*` environment
  contract, and the setup runbook in `docs/CI-AND-QUALITY-GATES.md`. The agent operates
  under ordinary `gh auth` as the repo owner.
- `required_approving_review_count: 1` drops to `0`. This is a GitHub branch-protection
  setting changed in repo settings — the one step here that cannot land as a commit.
- The persona+pass+model header convention and the `Vote:` line.
- The auto-merge severity gate. "Zero CRITICAL/HIGH merges" was machinery for an
  *automated* merge decision. Merge is now a human instruction, so severity stops being
  load-bearing — retiring the ~40 lines of calibration prose in `personas/riley.md`
  whose stated justification was that gate.

**What stays:**

- **The branch-per-story PR flow, reviewed by a person.** The repo owner reads the file
  list and changeset in the GitHub UI. What is removed is the *bot* approval ceremony —
  not the PR, and not the review.
- **Human-triggered merge.** The agent opens the PR, reports, and stops. Merge happens
  when the owner prompts for it. This replaces step 9 of the `§6` closeout protocol,
  where the implementing agent ran `gh pr merge --squash --delete-branch` off a clean
  severity table.
- **The full CI gate set** — lint, typecheck, unit, integration, functional API, merged
  coverage, `api:check`, `api:validate`, and the rule scanners.
- **The `§6` pause-for-approval list**, changed in role. Every merge now waits on a
  human, so the list stops being a *pause* trigger and becomes a *disclosure*
  requirement — see decision 2.

**Accepted tradeoff:** the independent read is not lost, it moves to the repo owner.
What narrows is resolution. A file-list-and-changeset review reliably catches scope
creep, unexpected files, and structurally wrong changes. It is less likely to catch a
subtle logic error inside a hunk that looks plausible — which is what a second agent read
was good at, not because that model is better but because it is not anchored to the
reasoning that produced the diff. `/code-review` before opening the PR covers most of
that residual gap at the cost of one command.

### 2. Move the review checklists to the implementer as disclosure triggers

The review personas hold lists of surfaces worth a careful look — Sage's security
surfaces, Perry's performance surfaces, the `§6` blast-radius list. With the bot
reviewers gone that knowledge would simply be lost.

Invert it: instead of a reviewer *detecting* these surfaces in a finished diff, the
implementer *declares* them as it introduces them. The PR body carries a **Review
triggers** section naming what warrants a closer read.

**The dividing line is mechanical versus judgment:**

- **Mechanical stays a scanner.** Forbidden application-code patterns
  (`check-no-mocked-api`), test-disable markers, env fallbacks. These already run
  enforcing in CI. Self-reporting them would be strictly weaker — an agent attesting "I
  added no fakes" is the same context that would have added them.
- **Judgment becomes a trigger.** Whether a new route's authorization boundary is
  correct, whether a query N+1s at realistic volume, whether a migration is reversible,
  whether a change moves a tenancy boundary.

The list lives in a new `rules/review-triggers.md`, and is the salvage destination for
the Sage and Perry surface lists as those personas retire in Plan 133.

**Calibration is the whole design constraint.** A trigger that fires on most PRs is
noise, and noise trains the owner to skim — at which point the mechanism is worse than
nothing, because it looks like coverage. Triggers are phrased as conditions, not
surfaces: "adds a mutating route" fires constantly; "adds a mutating route without an
authority preHandler" should be rare. Any trigger firing on a majority of PRs gets
narrowed or removed.

**The Riley marker is repurposed, not deleted.** `<!-- riley:findings -->` proved a table
was pasted; `<!-- review:triggers -->` carries something actionable.
`scripts/check-pr-riley-marker.mjs` becomes `scripts/check-pr-review-triggers.mjs` with
the same CI shape — presence-enforced, content unverifiable.

**Accepted weakness:** self-disclosure is bounded by the implementer's self-awareness. It
catches the case where the agent knows it did something notable; it does not catch the
case where the agent did not recognize the significance. That limit is why the mechanical
half stays mechanical.

## Data Model / API Surface Implications

None.

## Dependencies

- **The branch-protection change must land first.** Dropping
  `required_approving_review_count` to `0` happens in GitHub repo settings. If it is not
  done, `gh pr merge` fails against a requirement no bot can satisfy.
- **Plan 133 depends on this.** The persona roster cannot be settled while personas are
  defined as review passes.
- **Plan 134 receives the App setup runbook's deletion** as part of the
  `workflow-rules.md` decomposition.

## Execution Sequence

**First — flow removal.** Rewrite `§6` around branch → PR → CI → owner-reads →
owner-prompts-merge. Delete the App inventory, header convention, pass structure, and
auto-merge gate. Rewrite the closeout protocol so it ends at "report and stop." Delete
`scripts/gh-as-*.sh` and `scripts/get-app-installation-token.mjs`. Update
`docs/CI-AND-QUALITY-GATES.md`. Remove `gh-as-*` from `.claude/settings.json` —
`Bash(gh pr merge *)` stays, since the agent still merges when prompted. Correct the
stale model identifiers. Pair with the manual branch-protection change.

**Second — review triggers.** Write `rules/review-triggers.md`. Rename the marker scanner
and repoint the ci.yml step at `<!-- review:triggers -->`. Add a `gh pr create` PreToolUse
hook requiring the section — CI checks it too, but the hook catches it before the PR
exists rather than after.

These two should land together, or the second immediately after. Landing the first alone
opens a window where the bot review is gone and nothing has replaced its knowledge.

## Open Questions

- **What does the initial trigger list contain?** The first version will be miscalibrated
  in one direction. Worth deciding up front whether the correction loop runs on a cadence
  or only when the owner notices the section going stale.
- **Does `/code-review` before PR become a rule or a habit?** Making it a rule adds a
  gate; leaving it a habit risks it not happening. Current lean is habit, revisited if
  defects start reaching `main`.

## Sources / Prior Decisions

- ADR-0002 — Plans are narrative; deleted after parent epic closes
- Plan 133 — Persona library to task-shaped skills (consumes this plan's roster changes)
- Plan 134 — Rules consolidation (receives the runbook deletion)
