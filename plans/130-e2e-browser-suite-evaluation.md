# Browser E2E Suite — Evaluation, Reset, and Rebuild

**Tracking issue:** #80 (migrated from `pool-master-303`)

## Decision made

The existing suite depends on pre-existing, shared, mutated-in-place QA
data (a fixed league code, fixed fixture users) — that dependency is the
thing to eliminate, not patch around. Two phases:

- **Phase 1 (this plan implements it):** delete everything currently in
  `clients/poolmaster/e2e/` and replace it with the smallest possible test
  that reliably completes every run — no login, no seeded league, no shared
  mutable state of any kind.
- **Phase 2 (deferred, not designed here):** design a real e2e suite
  together later, once there's a clear view of what a real-browser test
  should uniquely cover that the rest of this repo's test layers don't
  already. This plan does not pre-decide that design — it's a placeholder
  slice/note, intentionally left thin.

## Purpose of the evaluation below

Before deleting anything, here's the evidence for *why* — real CI history,
not just a read of the code — so the reasoning survives after the old
suite is gone and isn't only "Derek's gut feeling was right."

## What the suite actually contains

6 spec files, ~24 lines average, plus shared fixture/setup machinery:

| File | What it checks |
|---|---|
| `auth.setup.ts` | Each of 3 fixture roles (root-admin/commissioner/member) can sign in, or self-registers if sign-in fails; saves Playwright storage state for reuse. |
| `authenticated-landing.e2e.ts` | Each role's landing surface renders a testid after `goto`. |
| `root-admin-navigation-smoke.e2e.ts` | Root admin can `goto` 7 `/manage/*` routes and see a testid on each. |
| `league-navigation-smoke.e2e.ts` | Commissioner/member can click through the primary nav menu and see a testid land. |
| `commissioner-league-setup.e2e.ts` | Commissioner can generate an invite link from the shared QA league. |
| `member-league-invite-acceptance.e2e.ts` | Member (already a member via fixture setup) can reach My Team. Despite the filename, it does not itself exercise invite *acceptance* — that happens inside the shared fixture (`ensureQALeague`), not as an observable, independently-failing test. |

**Every assertion in every spec is `expect(...).toBeVisible()` on a testid
after a `goto` or click.** None assert on data correctness, submitted-form
outcomes, or business logic. `poolmaster-e2e-helpers.ts` also exports
`createLeague` and `openCreateContestFlow` — neither is called from any spec
file. They're dead code, built for flows nothing currently exercises.

## What it costs — real CI evidence, not speculation

I pulled actual run history via `gh run list`/`gh run view` rather than
guessing:

- **Every one of the 8 most recent `main` CI runs (all from today) never
  actually ran the e2e suite at all** — `poolmaster-browser-e2e` was
  `skipped` in all 8, because it `needs: migrate-qa`, and `migrate-qa` has
  been failing or getting skipped upstream (the exact stuck-migration
  problem plan 129 addresses). Your sense that "it breaks often" has
  partly been measuring an unrelated infra problem wearing this suite's
  name — the job hasn't had a chance to pass *or* fail on its own merits
  recently.
- Going back further to runs where the job **did** actually execute, a
  16-run sample: **13 passed, 3 failed (~19% failure rate)**. That's a real,
  non-trivial number.
- I pulled the actual failure log for one of the three: it failed on
  `auth.setup.ts`'s commissioner sign-in with `Test timeout of 30000ms
  exceeded` on a `locator.fill` call — the login field didn't become
  interactable in 30 seconds. That's an environmental/timing flake, not a
  caught regression. (The other two failures' logs have already expired
  past GitHub's retention window, so I can't confirm their cause, but
  nothing in this suite's design gives me reason to expect they're
  different in kind.)

## Why it's fragile — architectural causes, not bad luck

- **Zero test isolation.** Every run reuses one fixed-code shared QA league
  (`qaLeagueSeed.code`) and 3 fixed fixture users, mutated in place across
  runs. `fixture-state.ts`'s `ensureQALeague` is ~130 lines of "detect the
  shared league is missing/conflicting/inactive and repair it" logic —
  create-or-look-up-or-delete-and-recreate, invite-or-verify-membership. This
  is inherently exposed to races and eventual-consistency gaps between runs,
  and it's *why* the config sets `workers: 1, fullyParallel: false` — the
  tests can't run concurrently without racing each other over shared state.
  That serialization is a symptom, not a separate problem.
- **Coupled to live deployment timing.** The CI job polls the real QA URL for
  up to 120 seconds (24 attempts × 5s) waiting for the HTML to reflect the
  new release before running anything. CDN propagation delay becomes e2e
  flakiness.
- **Coupled to an unrelated concern.** `needs: migrate-qa` means a schema
  migration failure — which has nothing to do with whether the UI renders —
  prevents the suite from running at all, with no distinct visibility that
  it didn't run vs. it passed.
- **No retries.** `retries: 0`. Playwright's own guidance for real
  network/browser e2e tests is to allow at least one retry in CI
  specifically because transient environment blips are expected; this
  config takes the harshest possible stance while also having the most
  exposure to exactly that kind of flake (shared remote state, real network,
  real deploy timing).

## What does it actually catch that nothing else does?

This matters for deciding how much investment is worth it. This repo already
has, at other layers:

- ~100 frontend component test files (React Testing Library + MSW), several
  hundred tests, asserting real interaction, validation, loading, and error
  states — strictly *deeper* per-page coverage than any assertion in the e2e
  suite, which only checks a testid is visible.
- FAPI functional tests exercising the real backend end-to-end through the
  generated SDK, with no provider/mock boundary — genuine integration
  coverage of business logic and data correctness.
- Contract-verification integration tests, and a full unit-test layer under
  both of those.

The e2e suite's only *unique* claim is "the actual production-built bundle,
served for real, in a real browser, against a real deployed backend, with
real cookies" — which is a legitimate thing to want, but the current suite
barely exercises it beyond page-load: no spec does a real form submission,
no spec checks a value came back correctly, no spec drives a multi-step flow
to a verifiable outcome. It pays the full fragility cost of "real
everything" for the assurance depth of a build smoke test.

## Phase 1 — delete everything, replace with a minimal ping

### Delete (all git-tracked, no `.auth/*.json` to worry about — those are
local Playwright storage-state artifacts, never committed)

```
clients/poolmaster/e2e/auth-state.ts
clients/poolmaster/e2e/auth.setup.ts
clients/poolmaster/e2e/authenticated-landing.e2e.ts
clients/poolmaster/e2e/commissioner-league-setup.e2e.ts
clients/poolmaster/e2e/fixture-state.ts
clients/poolmaster/e2e/fixtures.ts
clients/poolmaster/e2e/league-navigation-smoke.e2e.ts
clients/poolmaster/e2e/member-league-invite-acceptance.e2e.ts
clients/poolmaster/e2e/poolmaster-e2e-helpers.ts
clients/poolmaster/e2e/qa-users.ts
clients/poolmaster/e2e/root-admin-navigation-smoke.e2e.ts
```

This removes every dependency on pre-existing data: no fixed league code,
no fixture users, no shared mutable state, no repair-on-detect logic.

### Add — one spec, zero data dependency

`clients/poolmaster/e2e/ping.e2e.ts`: navigate to `/` and assert the
unauthenticated landing shell renders — the login form's identifier field
(`auth-login-identifier`, the same testid the old `auth.setup.ts` already
proved reliable) is visible. No login, no registration, no league, nothing
seeded. If the deployed bundle boots and routes to the sign-in screen, this
passes; if it doesn't, this is the one thing worth knowing.

### Update `playwright.config.ts`

- Remove the `auth setup` project entirely (`testMatch: /.*\.setup\.ts/`) —
  there's no setup file left.
- Remove `dependencies: ['auth setup']` from the `chromium` project — nothing
  to depend on anymore.
- `fullyParallel: true` — no shared state left to race over. Harmless with
  one test today, correct going into phase 2.
- `retries: 1` (CI only, matching Playwright's own guidance for real-network
  e2e) — directly serves "reliably complete each time": a transient blip on
  one attempt no longer fails the whole job.

### Update `.github/workflows/ci.yml`

- The `poolmaster-browser-e2e` job's summary step currently says "Journeys:
  stable role auth setup, reusable QA league repair, commissioner/member/
  root-admin route smoke" — update to something honest about the new scope
  (e.g. "Journeys: minimal deploy-reachability ping").
- Change `needs: migrate-qa` to `needs: publish-images` (the same thing
  `migrate-qa` itself depends on). The ping test doesn't touch the database
  at all — there's no reason an unrelated schema-migration failure should
  prevent "does the app boot" from ever getting a chance to run. This is a
  direct fix to the exact problem this evaluation found (all 8 of today's
  runs skipped the job for this reason) and belongs in phase 1, not deferred.
- The deploy-verification curl-polling step (waits up to 120s for the CDN to
  reflect the new release) stays as-is — it's a real, separate concern
  (confirming the *new* build is what's being tested) and isn't part of what
  lives in `e2e/`, so it's out of this phase's scope.

### Verification for phase 1

- `cd clients/poolmaster && npx playwright test` locally against a real
  running dev server (or QA) — confirm the single ping test passes.
- Confirm `npm run test:poolmaster:browser-e2e` / `:list` (root `package.json`
  aliases) still resolve correctly with only one spec file present.
- Push and watch the actual `poolmaster-browser-e2e` CI job run to
  completion (not skipped) at least once — this is the real proof, given
  the job hasn't gotten a chance to prove anything for a while.

## Phase 2 — the journey suite (designed 2026-10-01)

Phase 1 has been running clean. Phase 2 is now designed, and the three
questions phase 1 deferred are answered below.

### What a browser test uniquely proves

The other two layers are structurally blind to the same three things:

- `test:poolmaster:unit` (RTL) mocks `@/lib/api` — it cannot see a DTO
  mismatch, an auth-header bug, or a route that 500s.
- `test:service:functional-api` runs the API in-process against a local
  Postgres through the generated SDK — no browser, no bundle, no CDN, no
  cookie/storage behaviour, and never the schema that is actually deployed.

A deployed-build browser test is the only layer where the **shipped
artifacts agree with each other**: the bundle the CDN serves, the API image
ECS is running, the migrated QA schema, token refresh across a real origin,
and the router's guards. That — not business-rule correctness — is what it
is for. Business rules belong to the layers that can assert them cheaply.

So the suite's assertions stay deliberately shallow: a page landmark
rendered, a submitted form came back with the thing it created, a created
row is visible to another role. No exhaustive edge cases, no error-message
wording, no scoring math — those are already covered where they are cheap.

### How a run gets its data: everything but the root admin

QA is a persistent database, so "starts fresh" cannot mean a reset. It
means: **every row a run reads by identity was created by that run.**

- Exactly two pre-existing things are read by identity: the **root admin
  account** and the platform's **contest configuration templates**
  (`listContestConfigTemplates` — platform configuration, authored through
  `/manage/content-configuration`, not test data). Everything else — golf
  tour, season, players, event, field, tiers, commissioner user, league,
  contest, member user, squad, entry — is created by the run through the
  app's own UI.
- Every created name carries a per-run id: a short `runId` computed **inside
  the test body** (not at module load, so a Playwright retry gets a fresh
  one) and interpolated into every name, username, email, and league code.
  No two runs can collide, and anything left behind is identifiable.
- No fixed league code, no fixed usernames, no shared event. The phase-1
  failure mode cannot come back, because there is nothing shared to mutate.

Root admin credentials come from the environment, never from a literal in
the repo: `POOLMASTER_E2E_ADMIN_IDENTIFIER` (defaulting to the admin's
*username*, since the sign-in field accepts username or email, and the
fixture's address is a personal one that should not spread into more files)
and `POOLMASTER_E2E_ADMIN_PASSWORD`, which has no default — a spec that
finds it unset fails immediately with a message naming the secret rather
than timing out on a login form.

Registered users get `@e2e.invalid` addresses. `.invalid` is reserved by
RFC 2606 and can never be delivered, so no accidental mail can ever reach a
real person. Registration itself sends no mail (verified: there is no mailer
in `auth-service.ts`), and the suite never uses the email invitation path —
it uses the invite **link**, which is also the only member-join flow a
browser can complete unaided.

### Slicing: prove the plumbing before writing the journey

This design rests on five mechanisms that have never run together here:
CI-secret credentials reaching a Playwright run, a run id that makes names
unique across runs and retries, a brand-new user registering and writing
through the UI, a role switch inside one spec, and API teardown with the
admin token. Every one of them can fail for reasons that have nothing to do
with the product, and a long journey spec is the worst place to debug any of
them.

The journey itself then splits again, for the same reason at a smaller
scale. Act 1 — the golf catalog — carries nearly every assumption this plan
read off a component without executing: whether the tier board's move
control is a menu or a pair of arrows, whether a freshly added field
participant starts unassigned, what the player-create form requires beyond
a name. The commissioner and member acts were traced more completely. So
#84 builds the guards spec and act 1 and retires the ping, and #280 adds
the acts that consume the catalog, so a surprise in tier assignment cannot
hold up flows that carry less risk.

So the first slice (#278) is a **plumbing probe**: admin signs in and reaches
`/manage`, logs out, a fresh run-named user registers and creates a league,
and teardown removes both. No golf catalog, no contest, no invite, no entry
— if a step cannot fail for a plumbing reason, it is not in the probe. The
journey below is the second slice (#84) and does not start until the probe
has been green in a real `main` run. After that, a red journey means a
product bug, which is the only reason to have it.

### Shape: three specs, one of them a journey

`ping.e2e.ts` is on its way out. It asserts that `goto('/')` renders
`auth-login-identifier`, which is the first action of the post-deploy smoke,
so the smoke passing means ping could not have failed. Its one remaining
distinction is needing no credentials, which buys a triage split — ping red
means the deploy is broken, ping green with the smoke red means auth or
config — and `guards.e2e.ts` below erases even that, being credential-free
and covering strictly more. So ping keeps running, tagged, until guards
lands, and is deleted in the slice that adds guards.

Note what introducing `--grep @smoke` does to it: an untagged spec stops
running post-deploy. Preserving ping therefore means **tagging** it, not
leaving it alone; left untagged it would have dropped out of the only job it
ever ran in, without anyone deciding to.

**`guards.e2e.ts`** — unauthenticated surface, no data at all, fast, fully
parallel: a protected route redirects to sign-in, bad credentials surface an
error, an unknown invite code renders the invalid-invite state, an unknown
path renders the not-found page. This covers the router guards, which a
journey (always authenticated, always on the happy path) structurally
cannot.

**`golden-journey.e2e.ts`** — one `test()` with a `test.step()` per act, so
the HTML report reads as a narrative and a failure names the act. One test,
not four, because the acts share state (ids, codes, the invite URL) and a
split would either re-create the world per act or need serial mode plus
module-level state. `test.setTimeout` is raised for this spec only.

### The journey

Each act ends by logging out through the account menu, so the next act
starts from a genuinely unauthenticated browser rather than a cleared
storage key.

**Act 1 — root admin builds the catalog.** Sign in. Walk the list pages as
read checks (`/manage`, `/manage/events`, `/manage/leagues`,
`/manage/users`, `/manage/golf/tournaments`, `/manage/golf/players`),
asserting each page's landmark testid and the absence of
`shared-error-state`. Then create, in order: a golf tour
(`root-admin-golf-league-list-new`), a season under it
(`root-admin-golf-season-list-new`), **six** players
(`root-admin-golf-player-list-new`), and a tournament
(`/manage/golf/tournaments/new` — season select, name, start date a week
out, four rounds). Load the field by searching the six run-named players in
the add-participants modal (its free-text search spans every `Participant`,
so no league affiliation is needed) and submitting them in one call. On the
tiers page, place one player in each of the six default tiers with the
board's own move controls and save.

Six, not twelve, is deliberate: `DEFAULT_TIER_COUNT` is 6 with
`defaultPickCount: 1` each, so six players fill a six-pick roster exactly
one per tier. It also halves what a run leaves behind.

**Act 2 — a new commissioner.** Register a fresh user, create a league from
the welcome page (run-unique name and code), create a contest on act 1's
event (selected by its run-unique name from the picker, which filters
nothing and will contain QA's whole golf catalog), roster 6 / counted 4 /
one entry per team, and confirm it on the league's contest list and board
with zero entries. Then open the invite panel, generate the join URL, and
read it out of `league-join-url` — that string is the hand-off to act 3.
A description edit through `league-open-details` / `league-save-details` is
a cheap extra write worth keeping.

**Act 3 — a new member.** Open the invite URL unauthenticated, follow
`invite-create-account` (which carries the invite path through registration
and returns to it), name the squad in `join-league-team-name`, pick an icon,
and accept — one flow that covers invite preview, registration,
acceptance, and squad creation. Then browse to the contest, open the entry
builder, pick one participant from each of the six tier groups, set the
tiebreaker, and submit. Assert the entry on the board (`contest-board-entry-*`,
`contest-board-my-count`) and its six picks on the entry page. Cheap extras:
rename the entry inline, change a preference on `/my-account`, open the
league history page.

**Act 4 — scores, and the cross-role read (recommended, droppable).** Sign
back in as root admin, enter round-1 scores for the six players, transition
the event to the in-progress status, then open the contest leaderboard and
assert a scored participant cell renders. This is the one act that reaches
the scoring path rebuilt in #244–#248, which is exactly why it is worth
having — and the one act to drop first if it proves flaky, since it depends
on more admin surface than the rest. Close by confirming the new league
appears in `/manage/leagues` and both new users in `/manage/users`: the
cheapest possible proof that one role's writes are visible to another.

### Teardown

`test.afterAll` deletes what the run created, through the API with the admin
token (teardown is not the thing under test, so it does not go through the
UI): league first, then contest-free event, season, tour, and the two users.
It is best-effort — a teardown failure logs what it could not remove and
never fails the test.

Residue is expected and accepted: participants have no delete operation
(only `updateParticipant`), so the six players are inactivated rather than
removed, and a retried journey leaves a second set behind. Both are
identifiable by `runId`, and #83's QA reset is the backstop.

### Where the suite runs: pre-merge against a local stack, post-deploy as a smoke

Nothing in these specs is QA-specific. `baseURL` comes from
`POOLMASTER_E2E_BASE_URL`, and the client resolves its API base from
`window.location.origin` whenever `VITE_API_BASE_URL` is unset — which is
always, in every build this repo produces (it exists only as a commented
line in `.env.example` for local work). So the same bundle calls the same
`/api` paths wherever it is served, as long as something routes `/api` to
the API: CloudFront in QA, a dev-server or preview proxy locally.

That makes the suite runnable **before** any deploy, as an ordinary PR
check: a Postgres service container, migrate, boot core-api, serve the
built client, seed the job's own root admin, run. No AWS, no secrets, no
deploy. And that is where the **journey** belongs:

- A throwaway database per job removes the data problem outright. No
  accumulating leagues in QA's admin lists, no retry colliding with its own
  first attempt, no teardown debt. Teardown stays in the spec, but it stops
  being load-bearing.
- The job seeds its own admin, so the `POOLMASTER_E2E_ADMIN_*` secrets stop
  gating the heavy path.
- It fails before merge. A red post-deploy journey means the bad artifact is
  already in QA — which is exactly the failure phase 1's evidence found
  (ten unnoticed failed QA deploys, #191).

The post-deploy run is not redundant, because the two runs prove different
things. Pre-merge against a local stack proves **the code is coherent end to
end**: bundle, API, schema and SDK contract agree. Post-deploy against QA
proves **the environment is wired**: CloudFront serving the right release
prefix, `/api` path-routing to ECS, the ALB, the migrated QA schema, the
task's env and secrets, cookies over a real HTTPS origin. None of that
exists locally, and all of it has broken here before.

So:

- **Pre-merge job (new):** the journey plus the guards spec, local stack,
  throwaway database, every PR and every main push.
- **Post-deploy job (`poolmaster-browser-e2e`, existing):** a thin smoke —
  the ping, the guards spec, and an admin sign-in that reaches `/manage` and
  logs out. Keeps `needs: deploy-qa`, keeps the admin secrets, leaves
  essentially nothing behind.

**One spec set, selected by tag** — never two copies. The specs are mostly
selector plumbing, and selectors churn; two copies of "sign in as admin and
reach `/manage`" drift within a month, and once they differ a red
post-deploy run no longer distinguishes an environment problem from a stale
copy. That ambiguity is the one thing a deploy gate exists to resolve.

Playwright is on 1.59, so the first-class `tag` option on `test()` and
`test.describe()` carries this, with two npm scripts: the pre-merge one runs
everything, the post-deploy one runs `--grep @smoke`. Not projects, which
are for browsers and devices and would mean duplicating `use` blocks until
`baseURL`, trace and retry settings drift; and not a second config file,
which is the same failure with more surface.

The guards spec earns a place in both runs rather than only pre-merge: its
"unknown path renders not-found" case depends on CloudFront's
error-document config rewriting SPA routes to `index.html`, a deploy-only
failure mode no local run can see. Same assertion, different thing proven.

**Tags select tests, not steps — so the post-deploy set drives the act
structure.** Anything that must run after a deploy is its own `test()`, not a
`test.step()` inside a longer one; `--grep` cannot reach into a test and run
one of its steps. The two shapes that follow from that are both wrong: tagging
a whole multi-act test `@smoke` would have the post-deploy run register users
and create leagues in QA, and demoting the shared act to a standalone test
only would delete the role switch inside one browser session that the probe
exists to prove.

What works is a standalone tagged test and the longer untagged one calling
**one shared helper**, in **separate spec files**. Separate files because the
post-deploy smoke outlives the probe: this plan leaves open whether the
journey absorbs the probe and deletes it, and the one spec that has to
survive that should not live in the file most likely to be removed.

The shared act therefore runs twice in a pre-merge run, and that is coverage
rather than waste: it is the only place the standalone smoke test's own
fixtures, tag and assertions get exercised before a deploy, where otherwise a
bug in the test itself would first surface as a deploy failure.

A sign-in-and-log-out smoke **creates no domain data**, which is the accurate
claim and the reason it is the right post-deploy shape — not that it is
read-only. Sign-in issues a refresh token and logout revokes that one token
(`auth-service.ts`), so each post-deploy run leaves a revoked token row
behind, and concurrent sessions for the same admin stay safe.

### Owner ruling: the first journey acts are tagged `@smoke`, so the post-deploy run does write

**This supersedes the paragraph above as a statement of what post-deploy does.**
The reasoning there — that a no-domain-data smoke is the right post-deploy shape
— was an argument from safety, not from coverage, and the coverage gap it leaves
is the one that matters: with the local job running every spec and the QA job
running only `@smoke`, a breakage that exists **only in QA** anywhere past the
login screen is invisible. The deploy that stayed broken for four days
(see the deploy-qa section) failed in exactly that blind spot.

So the ruling is breadth now, detail later: **the first acts carry `@smoke` and
run post-deploy.** When the pre-release suite grows enough to carry the detail,
the narrow acts lose the tag and the QA set shrinks back toward a smoke. The tag
is a statement about what is worth proving against a real deploy today, not a
permanent property of a spec.

Four things this forces, none optional:

1. **Teardown becomes load-bearing, not hygiene.** Post-deploy runs now create
   leagues, squads, contests and users in QA on every merge to main. The probe's
   pattern is the floor: accumulate every attempt's created ids and remove them
   through the API in `afterAll`, per attempt, so a retry does not orphan the
   first attempt's data. Teardown that only runs on success will silently fill QA.

2. **The localhost-only guard must not be copied into the journey specs.**
   `plumbing-probe.e2e.ts` refuses any base URL whose host is not `localhost` or
   `127.0.0.1`, deliberately, because it writes domain data and the config
   defaults to QA. That guard is correct for a throwaway probe and is
   *incompatible with being tagged* — a tagged spec carrying it would throw on
   every post-deploy run. The journey specs need the opposite property: safe to
   run against QA by construction. Do not resolve this by loosening the probe's
   guard; the probe is superseded by #84 and retires.

3. **The member act must use the invite-link flow, not email invitations.**
   Verified on `774166f`: `POST /:id/invite-link` (`leagues/routes.ts:284`)
   returns the invite code in the response body, while the direct invitations at
   line 271 go out by email. The local stack has an SMTP sink; QA has SES and no
   inbox the suite can read. So the email path cannot complete post-deploy and
   the link path can. Registration itself is not gated — there is no
   `emailVerified` field or verification check anywhere in `modules/auth` or the
   Prisma schema — so register-then-login works against QA unassisted.

4. **The presence-not-absence rule stops being advice.** It was already stated
   below for dual-run specs; with writing acts running against a QA database that
   accumulates across months, any assertion on a count or an absence is a
   time bomb rather than a flake. Run-scoped names are what make presence
   assertions precise enough to be useful.

**The rule that keeps a dual-run spec honest:** it may assert the presence
of what the run itself created, never the absence or the count of what it
did not. "Both new users appear in `/manage/users`" holds everywhere;
"`/manage/users` lists exactly two users" passes against an empty local
database and fails against QA forever. That is the assertion someone adds
to make a flake go away.

Two things the local target must get right, both verified against the
configs on main:

- **Serve the production build, not the dev server.** `vite dev` is not the
  artifact: different module graph, no minification, no code splitting. The
  representative target is `vite build` plus a static serve. But
  `vite.config.ts` carries a `server.proxy` for `/api` and **no `preview`
  block**, so a `vite preview` run would not proxy `/api` at all — adding a
  `preview.proxy` mirroring the dev one (or serving the build behind a small
  proxy) is part of wiring this up, not an afterthought.
- **The asset base differs and that is fine.** The deployed bundle is built
  with `APP_ASSET_BASE=/releases/<sha>/`; a local build defaults to `/`. The
  release-prefixed asset layout is checked by the deploy job's own curl for
  `releases/<sha>` in the served HTML, which is the right place for it. The
  pre-merge run does not cover it, and should not pretend to.

### Open questions for the implementer — verify, do not assume

Every item here is something this design read from a component or a service
but did not execute. Read the component and run the flow; a wrong guess here
is the whole cost of the slice.

- The exact field set of each creation form (tour keyword, season tour/year,
  player create, tournament release/lock inputs) and of the league code
  validator — names and constraints come from the components, not from here.
- Whether the tier board's `root-admin-golf-tier-move-*` control is a menu
  needing a target or a pair of arrows, and whether a freshly added
  participant starts unassigned.
- Whether the contest form's template auto-selection fires reliably, and
  what it does when QA has no templates — the spec should fail loudly and
  legibly in that case rather than mid-form.
- Whether `deleteEvent` refuses while a contest references the event, which
  fixes the teardown order.
- Act 4's score-entry surface has thinner testid coverage than the rest.
  Adding the two or three testids it needs is in scope and is the right fix
  (`plans/137` sanctions `data-testid` for Playwright); text selectors are
  not.

### What act 1 found when it ran (#84)

Answers to the act-1 questions above, executed against the local stack:

- **The tier board's move control is both.** A native `<select>` per card
  (`root-admin-golf-tier-move-<fieldEntryId>`) moves a golfer across tiers
  and needs a target (`tier-1` … `tier-6`, the default tier keys); the
  `-up-`/`-down-` arrows only reorder inside a column. Cards are keyed by the
  **field entry** id, not the player id, so a spec reads the mapping from
  the field response the tiers page itself loads.
- **A freshly added participant starts unassigned** — confirmed; the act
  asserts it before each move.
- **The player form requires only a name** — but it cannot submit without
  a `GOLF` row in `sports`, which no migration creates and only provider
  ingestion does. A fresh database has none, so the act reads a third
  pre-existing thing by identity besides the root admin and the contest
  templates. The pre-merge job seeds that row; QA already has it.
- **The tournament form also requires release and field-lock times**, not
  just season, name, start and rounds; the season form requires a year and
  start and end dates, whose inputs had no testids (added).
- **Tours and seasons have no delete operation**, like participants. So
  teardown deletes the tournament (field, rounds and tiers go with it) and
  inactivates the tour, season and six players. Creating the tournament also
  creates a `league_events` row with no API to remove it. Every run leaves
  that residue in QA, all named with its run id.
- `shared-error-state`, named in the act above, did not exist; it is now
  the testid of every template page's load-failure state.
- An unauthenticated visitor to an unknown invite code never sees an
  invalid-invite state on the invite page — it only offers sign-in. The
  state appears on the sign-in page the invite hands off to
  (`auth-invite-preview-error`), which is what `guards.e2e.ts` asserts.

One consequence for #280: tags select tests, not steps, and act 1 is tagged
while acts 2–4 are not. They cannot be `test.step()`s inside act 1's test
without running post-deploy too, so the "one test, a step per act" shape
above does not survive the owner ruling as written.

### What acts 2–4 found when they ran (#280)

- **The journey is a serial file, not one test.** Acts 1–3 are `@smoke` and act 4
  is not, and a test inside a tagged describe cannot drop the tag. So each act is
  its own `test()` under `test.describe.configure({ mode: 'serial' })`: acts 1–3
  in a describe tagged `@smoke`, act 4 after it, untagged. Serial mode keeps all
  four in one worker so act 1's ids reach the rest through module state, and a
  failure skips the acts after it. A retry re-runs the file in a fresh worker
  with a fresh run id; each worker's `afterAll` tears down its own attempt.
- **Act 1's tournament was not contest-eligible.** Its release time was a day in
  the future, and an unreleased event drops out of the contest picker
  (`contestEligible` needs released, field loaded, field not locked). Release is
  now in the past; field lock stays at the start.
- **Contest templates are not a hard dependency.** They come from migrations, so
  QA and a fresh local database both have `golf-tiered-pick-6`. The form also
  submits without one when roster, counted scores and max entries are all set,
  which the act always does.
- **The entry builder opens one tier at a time and advances itself** after each
  saved pick. Toggling a tier by hand races that advance and can close the tier it
  just opened; the act waits for each golfer to appear instead. Tier group ids
  are tier UUIDs, not tier keys.
- **Round-1 scores go in through the bulk-load panel.** The corrections table only
  lists golfers who already have a score row, so a fresh event shows it empty.
- **No web page renders a golf score yet.** The board's expanded entry lists picks
  and status only; the score lives on `GET /contests/:id/golf/leaderboard`. Act 4
  asserts the board reveals the picks and reads the leaderboard endpoint for a
  round-1 score on each — presence only.
- **The `IN_PROGRESS` transition mails the league.** It activates the contest and
  sends `CONTEST_STARTED_SUMMARY` to every member. Locally the SMTP send fails and
  is logged; on QA it would go through SES to two `@e2e.invalid` addresses. That
  is part of why act 4 is untagged pending the owner's call.
- **Teardown needs no new operation.** League delete removes its contests,
  entries, squads, memberships and invitations in one transaction, which clears
  the `EVENT_HAS_CONTESTS` refusal on the tournament delete that follows.

### Explicitly out of scope

Email-sending flows (league email invitations, squad-owner invitations),
provider sync, contest settlement and payouts, and any assertion on scoring
arithmetic. The first group cannot be completed by a browser; the rest are
covered where they are cheap to cover.
