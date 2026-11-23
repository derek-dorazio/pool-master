---
name: scan-hard-coded-rules
description: A periodic sweep of the PoolMaster codebase for rules that belong in the model — per-league facts in constants and branches, name matching, id strings built and parsed, picking by array position, and facts computed in more than one place — reported grouped by area, with where each lives today and the model home it should move to. Use on a schedule (monthly, or when an epic closes), before designing a model change, or when someone asks what is still hard-coded.
user-invocable: true
allowed-tools: [Read, Grep, Glob, Bash, Write]
---

# Scanning for hard-coded rules

The rule is `rules/domain-model-conventions-rules.md` §17 *Rules Live In The Model, Not In
Code*. Reviews catch new cases one diff at a time (`rules/review-triggers.md` §9 *Reviewing
for hard-coded rules*); this sweep finds what is already merged, because a fact copied five
times only looks like a problem when all five are seen together. The output is a report the
owner reads and turns into model changes, not a code change.

Read-only. Change no code during a scan.

## Step 1 — search each pattern across the whole tree

Search `packages/core-api/src`, `packages/shared` (not its `generated` folder) and
`clients/poolmaster/src`, leaving out tests and test helpers. These are starting points;
every hit is read in context before it is counted.

```bash
SRC="packages/core-api/src packages/shared/domain packages/shared/dto packages/shared/utils clients/poolmaster/src"
BACKEND="packages/core-api/src packages/shared/domain packages/shared/utils"
EXCL=(-g '!*.test.*' -g '!**/test/**' -g '!**/generated/**')

# 1. Name matching
rg -n "${EXCL[@]}" "\.(name|title|label|displayName)\b[^;]*(===|!==|includes\(|startsWith\(|endsWith\(|match\()" $SRC
rg -n "${EXCL[@]}" -i "keyword|NAMES?\s*=\s*\[|Pattern\s*=" $SRC

# 2. Id strings built or parsed
rg -n "${EXCL[@]}" '`[a-z]*\$\{[^}]+\}-[^`]*`' $BACKEND | rg -v -i 'testid|log|message|Error\('
rg -n "${EXCL[@]}" "new RegExp|\.exec\(|(id|Id|Ref|ref|slug|key)\??\.(split|match|startsWith|replace)\(" $SRC

# 3. Position as identity
rg -n "${EXCL[@]}" "\.at\(-1\)|length - 1\]|\[0\]\??\.(id|key|round|status)|indexOf\([^)]*\) \+ 1|roundNumber\s*(===|>=|<=)\s*\d" $SRC

# 4. Per-league or per-sport facts in code
rg -n "${EXCL[@]}" "Record<[A-Za-z]*(League|Sport|Season|Provider)[A-Za-z]*,|case '[A-Z_]+':|ROUND|SEED|ROLLOVER|MONTH|YEARS?_AHEAD" $SRC
rg -l "${EXCL[@]}" "" packages/core-api/src/modules/ingestion | rg -i "mapping|reader"   # one file per league?

# 5. Facts computed more than once
rg -n "${EXCL[@]}" "getFullYear\(|getUTCFullYear\(|new Date\(\)\.getMonth" $SRC
rg -n "${EXCL[@]}" "\[[^\]]*Status\.[A-Z_]+,[^\]]*Status\.[A-Z_]+[^\]]*\]\.includes" $SRC
rg -n "${EXCL[@]}" -i "keep in sync|mirrors? the (server|backend|api)|same rule as" $SRC

# 6. Provider keys outside a ProviderMapping table
rg -n "^\s+(externalId|externalIds|externalGameId|providerRef|provider[A-Z]\w*Id|matchKeyword)\b" packages/core-api/prisma/schema.prisma
rg -n "${EXCL[@]}" "\b(externalId|externalGameId|providerRef|matchKeyword)\b" $BACKEND

# 7. Either/or parent pairs: models with two or more optional foreign keys
awk '/^model /{m=$2} /^[[:space:]]+[A-Za-z]+Id[[:space:]]+String\?/{n[m]++; f[m]=f[m]" "$1}
  END{for (k in n) if (n[k] > 1) print k ":" f[k]}' packages/core-api/prisma/schema.prisma

# 8. Generic words stored as data
rg -n "^\s+(label|displayName|\w+Names|\w+Labels)\s" packages/core-api/prisma/schema.prisma
rg -n -i "'(Week \d+|Round \d+|Quarterfinals?|Semifinals?|Final)'" packages/core-api/prisma/migrations $BACKEND

# 9. Facts the feed supplies, recomputed
rg -n "${EXCL[@]}" -i "(compute|derive|calc)\w*(Position|ToPar|Total|Tie|Cut|Status)\b" $BACKEND
```

Then do the search no pattern does: **list the facts, not the code.** For each concept in
`rules/domain-model-concepts.md` that has a derived property (the current season, whether an
event is over or started, the final round, round labels, whether an event is a week of games,
a contest's event limit, which events can take a contest, whether a league is synced and by
which provider), find every place that works it out. Two or more is a finding even when no
single line looks wrong; note whether the copies already disagree. For each fact, also ask
whether the feed already supplies it: a value we compute that the provider sends is a finding
even with one copy (`rules/domain-model-conventions-rules.md` §17 *One computation per
fact*).

Read each hit of searches 6 to 8 against its rule: a provider key belongs only in a
`…ProviderMapping` table (§17 *Provider keys live only in ProviderMapping tables*); a model
with two optional foreign keys is a finding only when exactly one is meant to be set (§9 *No
nullable either/or parents*); a stored word is a finding when every league shares it, and fine
when it is one real thing's proper name (§17 *Proper names are data, generic words are
strings*).

## Step 2 — sort the hits

Drop what §17 *What stays in code* keeps in code: a provider's wire format parsed inside its
adapter, a scoring family's arithmetic, a code-to-label map on screen, URL path parsing in
the router. Keep the rest and group them:

- **Hard-coded rules that move into the model** — one row per rule, however many files carry
  it.
- **Model shapes that break a convention** — a provider key outside a mapping, an either/or
  parent pair, a generic word stored as data — one row per table.
- **Facts worked out in several places** — one row per fact.

## Step 3 — write the report

Two tables, with these columns, and one line each:

| Rule in code today | Where (files and symbols, no line numbers) | Model home |
|---|---|---|

| Fact | Copies today | Already disagree? | One home |
|---|---|---|---|

"Model home" is specific: the definition and column, the reference rows and their key, the
provider mapping table, the API field, or the shared helper and the type it sits beside. Where
the home does not exist yet, say what new concept it is (`rules/domain-model-conventions-rules.md`
§14 *Gaps Are Requirements*). Add a short "keep in code" list for what was looked at and left,
so the next scan does not re-litigate it, and a count per group against the last scan's report
so the trend shows.

Deliver it where the owner reads design work (a design page or a document in the project) and
attach it to the open epic for the model work if one exists.

## Step 4 — turn it into work

Do not file one ticket per hit. Propose the groups as model changes to the owner: each group is
one ticket naming the model home and every site it replaces, sequenced so the model lands
before its readers (`rules/model-change-rules.md`). A group the owner defers stays in the next
report.

## Traps

- **Counting lines instead of rules.** Five readers with five rollover months is one rule with
  five copies, and one model home.
- **Proposing a code constant as the fix.** Moving a table into a shared constant file gathers
  it but leaves it in code; the home is a model row set by migration
  (`rules/architecture-rules.md` §6 *Reference data goes in a migration*).
- **Proposing a sport- or league-specific home.** The property goes on the definition every
  league carries (`rules/workflow-rules.md` §1 *One global solution, never one sport's*).
- **Trusting a pattern's silence.** The duplicated-fact search in Step 1 finds more than the
  regexes; do it every time.
