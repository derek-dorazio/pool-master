---
name: review-a-pr
description: Reviewing someone else's PoolMaster pull request — read the plan and the PR's disclosures, run the general correctness pass, apply every lens the diff has a surface for and always the hard-coded-rules lens, then post findings on the PR with a model home for each and a clear verdict. Use when asked to review a PR, or when a review thread is started for one.
user-invocable: true
allowed-tools: [Read, Grep, Glob, Bash]
---

# Reviewing a PR

A review here is one pass with lenses, not a vote per lens (`rules/review-triggers.md`
§1 *The dividing line: mechanical stays a scanner* says what the scanners already catch, so
do not spend the read on it). The failure this skill exists to stop: PRs that passed review
while adding name matches, id strings built and parsed, positional lookups, per-league
constant tables and second copies of a computed fact. Each hunk read as plausible; nobody
read for the pattern. Step 4 is therefore never skipped.

Never review your own PR: the context that wrote the code is the one that would miss its
faults.

## Step 1 — know what the PR is meant to do

- Read the linked issue and, if there is one, the plan it implements. Note the decision the
  plan records; scope creep is visible only against it (`rules/review-triggers.md` §7
  *Reviewing for architectural fit*).
- Read the PR body's Review triggers section and blast-radius disclosure
  (`rules/review-triggers.md` §2 *The trigger list*). A trigger the diff plainly has and the
  body does not name is itself a finding.
- Get the whole diff and the file list. Check the branch is based on a recent main; a review
  of a stale base misses conflicts with work that just landed.

## Step 2 — the general pass

Run `/code-review` on the PR for correctness. Read its findings critically: keep what holds
up against the code, drop what does not, and say which you dropped if it matters.

## Step 3 — the lenses the diff has a surface for

Apply each only when the diff has its surface; skipping is normal.

| The diff… | Lens |
|---|---|
| Adds or changes a query, a list read, a loop over rows, polling or a payload | `rules/review-triggers.md` §5 *Reviewing for performance cost* |
| Touches a route, auth, a role, league isolation, secrets or a provider | `rules/review-triggers.md` §6 *Reviewing for security* |
| Touches contracts, crosses a module, names a sport or league, or departs from its plan | `rules/review-triggers.md` §7 *Reviewing for architectural fit* |
| Adds or changes a screen | `rules/review-triggers.md` §8 *Reviewing for UI conformance* |
| Adds or changes tests | `rules/testing-rules.md` §1A *Test Self-Documentation* and §3 *Defect Verification Protocol* |

## Step 4 — the hard-coded-rules lens, always

For every diff that touches production source, apply `rules/review-triggers.md` §9
*Reviewing for hard-coded rules* to every added and changed line. Read the hunks, then
search the added lines so nothing is skimmed past:

```bash
git diff origin/main...HEAD -U0 -- 'packages/*/src' packages/shared clients/poolmaster/src \
  | grep '^+' | grep -v '^+++' \
  | grep -nE "\.(name|title|label|displayName)\b.*(===|!==|includes\(|startsWith\(|endsWith\(|match\()|\.split\(|\.match\(|new RegExp|\.exec\(|\`[^\`]*\\\$\{[^}]*\}-|\[0\]\??\.(id|key|round|status)|\.at\(-1\)|length - 1|indexOf\(.*\) \+ 1|getFullYear\(|getUTCFullYear\(|Record<[A-Za-z]*(League|Sport|Season)[A-Za-z]*,|keep in sync"
```

A hit is a place to read, not a verdict; the calibration paragraph in §9 says what is fine.
If the diff touches `schema.prisma` or a migration, also read every added column and model for
a provider key outside a `…ProviderMapping` table, an either/or pair of nullable parents, and a
generic word stored as data (`rules/review-triggers.md` §9 items 6 to 8):

```bash
git diff origin/main...HEAD -U0 -- packages/core-api/prisma \
  | grep '^+' | grep -v '^+++' \
  | grep -nE "externalId|Ref\b|provider[A-Z][A-Za-z]*Id|matchKeyword|[a-z]+Id +String\?|label|displayName|Names\b"
```

If the diff touches `clients/poolmaster/src`, search its added lines for a domain value
(`rules/review-triggers.md` §9 item 10):

```bash
git diff origin/main...HEAD -U0 -- clients/poolmaster/src \
  | grep '^+' | grep -v '^+++' \
  | grep -nE "(OPTIONS|_MAX|_MIN|DEFAULT|LIMIT|THRESHOLD|PENALTY)[A-Z_]*\s*=|Array\.from\(\{ *length:|(min|max|step)=\{-?[0-9]|defaultValues|\.(min|max)\(-?[0-9]"
```

The §9 calibration says which hits are fine (a whole enum in its declared order, a display cap).

Then ask the questions no search answers: **does this compute something the codebase already
computes, or something the feed already supplies?** Search for the fact (the current season, whether an event is over, the final
round, a contest's event limit), not for the function name the author chose
(`rules/domain-model-conventions-rules.md` §15 *Residue — The Right Mechanism, Built Then
Bypassed*). On the web side, ask whether the screen is re-deriving what the API decides.

For each finding, name **the model home** it belongs in: a column on a definition, reference
rows set by migration, a provider mapping table, a field the API returns, or one shared
helper beside its type (`rules/domain-model-conventions-rules.md` §17 *Rules Live In The
Model, Not In Code*). "Hard-coded" alone gives the author nothing to do.

## Step 5 — post the review

Post on the PR as one review comment (an agent's approval posts as a comment, since it
shares the author's account):

- **Verdict first:** Approve, Approve with nits, or Changes requested.
- **Blocking** findings: correctness, security, a contract out of sync, and any hard-coded
  rule or second computation the diff *adds*. Each with file, symbol, what goes wrong, and
  the fix or model home.
- **Nits:** fixed before merge, small.
- **Follow-ups:** a pre-existing hard-coded rule the diff touches but cannot move without a
  model change. Ask for a linked ticket naming the model home; the PR must not add another
  copy of it.
- What you checked and found clean, in one line per lens applied, so the owner can see the
  hard-coded-rules lens ran.

A re-review after fixes reads only the new commits, plus anything a merge from main changed.

## Traps

- **Reviewing the hunk, not the codebase.** A constant that looks local may be the fourth
  copy. Search before accepting it.
- **Accepting "the provider sends a name" as the end of the story.** It is acceptable only
  inside the adapter, as an inclusion-only mapping table whose miss raises the finding
  `rules/domain-model-conventions-rules.md` §17 *Provider keys live only in ProviderMapping
  tables* describes; everything past the adapter is keyed.
- **Waving through a positional pick because the array is sorted.** Sorting is fine; "the
  last one is the final" is identity by position.
- **Letting a web helper mirror a server rule because it is small.** It is the copy that
  drifts; ask for the API to return the value.
