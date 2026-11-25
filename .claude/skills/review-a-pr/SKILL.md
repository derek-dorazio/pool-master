---
name: review-a-pr
description: Reviewing someone else's PoolMaster pull request — read the plan, the ticket's checklist and the PR's disclosures, run the general correctness pass, apply every lens the diff has a surface for and always the hard-coded-rules lens, check every ticket line, test layer and retired name against the whole branch, then post findings on the PR with a model home for each and a clear verdict. Use when asked to review a PR, or when a review thread is started for one.
user-invocable: true
allowed-tools: [Read, Grep, Glob, Bash]
---

# Reviewing a PR

A review here is one pass with lenses, not a vote per lens (`rules/review-triggers.md`
§1 *The dividing line: mechanical stays a scanner* says what the scanners already catch, so
do not spend the read on it). The failure this skill exists to stop: PRs that passed review
while adding name matches, id strings built and parsed, positional lookups, per-league
constant tables and second copies of a computed fact. Each hunk read as plausible; nobody
read for the pattern. Step 4 is therefore never skipped. The second failure: PRs that passed
review while leaving undone what their ticket asked for, because the review read only the
diff and a diff cannot show a file that should have changed. Step 5 is never skipped either.

Never review your own PR: the context that wrote the code is the one that would miss its
faults.

## Step 1 — know what the PR is meant to do

- Read the linked issue and, if there is one, the plan it implements. Note the decision the
  plan records; scope creep is visible only against it (`rules/review-triggers.md` §7
  *Reviewing for architectural fit*).
- Read the ticket **body and every comment on it**. Its *Scope*, *Retires*, *Readers* and
  *Tests* lines are your checklist for step 5 (`rules/workflow-rules.md` §1 *A slice ticket is
  a checklist*). Copy them into your notes now, one line each. If agreed review comments were
  never folded into the body, read them as part of it and say so in the review.
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

## Step 5 — the ticket against the whole branch, always

For every PR that implements a ticket, apply `rules/review-triggers.md` §10 *Reviewing
against the ticket: omissions and leftovers*. Work from the checklist you copied in step 1:

1. **Tick each Scope line** against the diff and the PR body's ticks. A line with no change
   and no linked deferral ticket is blocking. Check the omissions as hard as the additions:
   a "the web reads X from the DTO" line is done only when the web code that worked X out is
   gone, and that file may not be in the diff at all.
2. **Tick each Tests line** by opening the test file at the layer it names
   (`rules/testing-rules.md` §2 *Each slice names its layers*). Confirm the pinned
   query-count case for each list GET the slice adds or changes, and that a defect fix's
   failing test came first. Coverage floors are CI's; do not re-measure them.
3. **Search the PR's head for every retired name**, not the diff:

```bash
for name in <each name in the ticket's Retires section>; do
  echo "== $name"; git grep -nw "$name" -- packages clients/poolmaster tests scripts docs rules .claude     ':!**/migrations/**' ':!packages/shared/generated/**'
done
```

   Each hit outside a migration or a deliberate historical note is a leftover: blocking when
   this slice owns it, a linked ticket when a later one does. Confirm the PR lowered or
   deleted the name's entry in `scripts/retired-names.json` (`rules:check:retired-names`
   fails a count that dropped without it, but not one the slice forgot to remove).
4. **Search for the old computation by what it computes**, not by its name, for each fact
   the slice moves into the model (`rules/review-triggers.md` §9 item 5).
5. **Read every raise the PR declares** in `scripts/baseline-raises.json`. Each one lets a
   baseline go up, and the reason must justify it. A new `poolmaster-allow-raw-sql` marker names
   what Prisma cannot express (`rules/service-rules.md` §5 *Prisma and Persistence*). A raise
   whose reason does not hold is blocking.

Report the result as a table in the review, one row per checklist line: the line, ✓ or the
finding, and the file or ticket that settles it.

## Step 6 — post the review

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
- The ticket checklist table from step 5.
- What you checked and found clean, in one line per lens applied, so the owner can see the
  hard-coded-rules lens ran.

A re-review after fixes reads only the new commits, plus anything a merge from main changed.

## Traps

- **Reviewing the hunk, not the codebase.** A constant that looks local may be the fourth
  copy. Search before accepting it.
- **"Matches the ticket" without ticking it.** Writing that a PR matches its ticket is not a
  check. Each line gets its tick or its finding; an unticked line is the one that ships
  undone.
- **Accepting "the provider sends a name" as the end of the story.** It is acceptable only
  inside the adapter, as an inclusion-only mapping table whose miss raises the finding
  `rules/domain-model-conventions-rules.md` §17 *Provider keys live only in ProviderMapping
  tables* describes; everything past the adapter is keyed.
- **Waving through a positional pick because the array is sorted.** Sorting is fine; "the
  last one is the final" is identity by position.
- **Letting a web helper mirror a server rule because it is small.** It is the copy that
  drifts; ask for the API to return the value.
