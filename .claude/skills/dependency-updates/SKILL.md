---
name: dependency-updates
description: The weekly pass over PoolMaster's dependencies — land each open Dependabot pull request through the normal gates, review and merge spacing, set aside an update that breaks, and propose each new major version to the owner with a recommendation, and check the Node, container image and PostgreSQL security fixes Dependabot cannot see. Use on the Monday dependency run, or when a Dependabot security PR arrives midweek.
user-invocable: true
allowed-tools: [Read, Grep, Glob, Edit, Bash]
---

# Weekly dependency updates

Dependabot opens the pull requests; this skill lands them. What Dependabot opens, and when, is
`.github/dependabot.yml`:

- **npm**: one grouped PR a week with every minor and patch update.
- **Docker base images** (`infrastructure/docker/Dockerfile.*`): one grouped PR a week, minor
  and patch only.
- **GitHub Actions**: one grouped PR a week, majors included, because workflows pin actions
  by major tag.
- **Security updates**: grouped per ecosystem, opened whenever an advisory lands, any day of
  the week. One can be a major when that is the only fixed version.

The weekly PRs open Monday 04:00 Eastern, so by the time the run starts their CI has finished.
Majors of npm packages and Docker images never get a PR: they change how we write code and
are planned as tickets of their own. Step 6 is how the owner still hears about them.

A Dependabot PR is an ordinary PR here. It goes through the same gates, the same separate
review and the same merge go as any other (`rules/workflow-rules.md` §6 *Branching, Review,
and Merge Cadence*). Never skip, disable or quarantine a test to get one green
(`rules/testing-rules.md` §1C *Test-Disable Discipline*), and never bend application code
around a library change (`rules/testing-rules.md` §1B *Forbidden Application-Code Patterns*).

## Step 1 — what is open

List the open PRs whose author is `dependabot[bot]`. With none open, still do Steps 6
and 7; when none of them has anything to report, post nothing, schedule the next Monday and
stop. A quiet week is silent.

Take the PRs one at a time, security PRs first. Each PR you finish rebases the others, so
working them in parallel only produces conflicts.

## Step 2 — check it out and run the gates

1. Fetch the PR's branch (`dependabot/...`) and check it out. Dependabot regenerated
   `package-lock.json`; run `npm ci`, then
   `npx prisma generate --schema packages/core-api/prisma/schema.prisma`.
2. Run the whole gate set, `rules/workflow-rules.md` §3 *Required Local Validation Before
   Push*. A dependency bump is not "docs only": a minor of a code generator, a linter or a
   test runner fails in places the diff does not touch. Lint needs a larger heap than Node's
   default, and the whole-repository `npm run lint` runs out of even 6 GB, so run its two
   halves the way CI does; together they cover the same files:

   ```
   NODE_OPTIONS=--max-old-space-size=6144 npm run lint:service
   NODE_OPTIONS=--max-old-space-size=6144 npm run lint:webapp
   ```

3. `api:check` failing after a bump of the OpenAPI or client generators means the generated
   files changed: run `npm run api:refresh` and commit what it writes. Read that diff; a
   generator minor that changes the shape of a type is a review question, not a formality.
4. **A Docker PR that moves Node** also needs `.nvmrc` set to the same version, in the same
   PR: CI installs Node from `.nvmrc` and Dependabot does not touch it. Both Dockerfiles and
   `.nvmrc` name one version.

## Step 3 — when a gate fails

Read the failure as for any other change (the `release-check` skill). Then:

- **Small and clearly caused by the update** (a renamed option, a new lint finding, a type
  that tightened): fix it on the branch, run the gates again, push.
- **Larger than a small fix, or the library changed behaviour we rely on**: put that one
  package back to its previous version on the branch (`npm install <name>@<old version>` in
  the workspace that declares it), add an `ignore` entry for it to `.github/dependabot.yml`
  with a comment naming the new ticket, file the ticket with the failure and the release
  notes, and land the rest of the group. Tell the owner in one line. The ticket's PR removes
  the `ignore` entry.
- **A PR with a single update that breaks** (a security PR, often): close it with a comment
  saying why and naming the ticket. A security fix that cannot land goes to the owner at once,
  with the advisory's severity and whether our code reaches the vulnerable path.

Once anyone else has pushed to a Dependabot branch, Dependabot stops rebasing it. From then on
bring `main` in yourself (the `land-a-pr` skill, Step 1). Before your first push,
`@dependabot rebase` in a PR comment is the cheaper way to catch up.

## Step 4 — review

When CI is green, ask the coordinator for a separate review; the run never reviews its own
PRs. Dependabot writes the PR body and rewrites it on every rebase, so put what our template
asks for (gates run, anything fixed or set aside, the ticket for it) in a PR comment instead.
The review reads the changelogs of the minors, not just the diff: a minor that changes
behaviour passes every gate when no test covers that behaviour.

## Step 5 — merge

On the go, land it with the `land-a-pr` skill. Squash with the PR's title; the body names
the run's ticket only if this PR finishes one. Keep to the merge spacing in
`rules/workflow-rules.md` §6 *Slices in a series*: two Dependabot merges close together are
fine, a third waits for `main`'s run.

## Step 6 — new major versions

Majors get no PR, so look for them, on an up-to-date `main` after `npm ci`. Without
`node_modules` npm has no current version to compare, and the command prints nothing, which
looks exactly like a quiet week:

```
npm outdated --json | node -e 'const o=JSON.parse(require("fs").readFileSync(0,"utf8"));for(const[n,e]of Object.entries(o)){const v=[e].flat()[0];if(parseInt(v.latest)>parseInt(v.current))console.log(n,v.current,"->",v.latest)}'
```

A package declared in more than one workspace comes back as a list, one entry per workspace,
all with the same hoisted current version; `[e].flat()[0]` takes the first. Comparing the
list itself drops exactly the shared packages (zod, TypeScript), the majors that matter most.

Also check the Node release schedule for a new LTS line, and whether a pre-release we are
waiting on has gone final (npm can list a release candidate as `latest`; read the version,
not the tag).

Report only what is new since the last report: a new major line, or a pre-release that went
final. Keep the list of majors already reported in project memory so the same one is not
proposed every week.

For each, write the owner a short upgrade proposal, for the project chat:

- **What changed**: the headline breaking changes and what the major adds, from its release
  notes or migration guide.
- **What it touches here**: which workspaces declare it and roughly how much of our code
  uses the changed parts (a search, not a guess).
- **Risk**: what could break that the gates would not catch.
- **Recommendation**, one of: *upgrade now* (a security fix, a feature we want, or our
  version leaving support), *wait* (say what for: the first patch release, a library we
  depend on catching up), or *skip* (nothing in it for us, and why).

A yes from the owner becomes a ticket in the normal flow: plan, implement, separate review.
The weekly run does not start a major on its own.

`@types/node` follows the Node line we run, not npm's latest; report it with Node.

## Step 7 — what Dependabot cannot see

Dependabot reads `package-lock.json`, the Dockerfiles and the workflows. Three things we run
are in none of them. Check each weekly, and report only when we are affected:

- **Node.js security releases.** Compare the Node security release announcements since last
  week with `.nvmrc`. When one fixes our line and the Docker PR has not already moved us, move
  `.nvmrc` and both Dockerfiles together in a PR of their own.
- **The core-api image's scan.** ECR scans every image on push (`scan_on_push` in
  `infrastructure/terraform/main.tf`). Read the findings for the newest image in the QA
  `core-api` repository and report High and Critical findings only, with the package and
  whether a fixed version exists. Most come from the Debian base image and are fixed by the
  next Node image; say so rather than filing a ticket for each. Reading them needs AWS read
  access: if the session has none, say so to the owner once, not every week.
- **PostgreSQL security releases.** The database is RDS on PostgreSQL 16, its engine version
  in `infrastructure/terraform/main.tf`. Compare PostgreSQL's security releases with the
  minor version RDS is running. RDS applies minor versions in the maintenance window unless
  automatic minor upgrades are off; report a fix we are still missing a week after release.

These go in the same note as Step 6, after the majors.

## Step 8 — next week

Schedule the next run for Monday morning, after Dependabot's 04:00 Eastern, and stop. Reply
to the owner only for a merge that needed a fix worth knowing, a set-aside update, a security
PR that cannot land, or the note from Steps 6 and 7.

## Where this goes wrong

- **Treating a green Dependabot PR as reviewed.** Gates prove what is tested. The changelog
  says what changed.
- **Closing a whole group for one bad package.** Every other update in it waits a week for
  nothing. Set aside the one package and land the rest.
- **Leaving an `ignore` entry behind.** It silently freezes that package. Each one names its
  ticket, and the ticket removes it.
- **Moving Node in the Dockerfiles but not `.nvmrc`.** CI tests one Node version and the
  image ships another.
- **Merging Dependabot PRs back to back.** Three merges inside one `main` run lose a verdict;
  Dependabot's rebases after each merge also re-run every other open PR's CI.
