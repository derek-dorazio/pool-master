---
name: run-local-stack
description: Running the whole PoolMaster app inside an agent's container, with a root admin and last-season test data, to take screenshots, review a screen on a phone width, or run the browser E2E suite. Use when work needs the real app on screen and the QA site is out of reach.
user-invocable: true
allowed-tools: [Read, Grep, Glob, Edit, Write, Bash]
---

# Running the stack locally

A cloud session cannot reach the QA site, but it can run the app itself: Postgres, the API and
the web app, signed in as a root admin, with each sport league's test data loaded through the
admin API. The CI job `poolmaster-browser-e2e-local` in `.github/workflows/ci.yml` does exactly
this on every PR; when a step below stops working, that job is the reference, because CI keeps
it green.

Nothing here touches application code. A screen that looks wrong with real test data is a bug
to fix, never a reason to add a sample payload or a "local mode" branch (`rules/testing-rules.md`
§1B *Forbidden Application-Code Patterns*).

## Step 1 — database and setup

1. Start Postgres, which is installed but stopped in a fresh container: `sudo service
   postgresql start`, set the `postgres` user's password, and create a database for the app
   (keep it apart from `poolmaster_test`, which the test suites empty).
2. Copy `.env.example` to `.env`, set `DATABASE_URL` to that database and a freshly generated
   `JWT_SECRET`, and export `DATABASE_URL` in each shell that runs a command below.
3. `npm ci`, `npx prisma generate --schema packages/core-api/prisma/schema.prisma`, `npx prisma
   migrate deploy` with the same schema, and build `@poolmaster/shared`.
4. Create the root admin with `packages/core-api/scripts/bootstrap-users.mjs`, passing a
   one-user fixture in `FIXTURE_JSON` with `isRootAdmin: true` and a password you generate.
   It is a fixture script (`rules/architecture-rules.md` §6 *Fixture data goes in a bootstrap
   script*); never write users into the database by hand.

## Step 2 — run it

- **To look around or take screenshots:** the API with `npm run dev -w @poolmaster/core-api`
  (port 3000) and the web app with `npx vite` in `clients/poolmaster` (port 5173), each in the
  background with its output in a log file. Wait for `/health` before loading data.
- **To run the browser E2E suite:** build with `npm run build:poolmaster` and serve it with
  `npx vite preview` (port 4175), the API proxied behind it, as the CI job does, with its
  `POOLMASTER_E2E_*` variables pointing at your admin.

## Step 3 — test data

Load test data through the admin API with the loader, never through SQL
(`rules/architecture-rules.md` §6 *Manual-testing seed data goes through the admin API*):
`npm run seed:golf` with `POOLMASTER_SEED_BASE_URL`, `POOLMASTER_SEED_ADMIN_IDENTIFIER` and
`POOLMASTER_SEED_ADMIN_PASSWORD` set, `--mode apply --allow-test-data`, and either one `--file`
or `--all-test-data`. Add `--with-participants` for test players with entries in each league's
test pool, so leaderboards have rows. Every sport takes more than nine minutes; load only the
sports the screen needs. `docs/SPORT-DATA-LOADING.md` *Loading every test file, with test
players* says what each option creates.

## Step 4 — the browser

Chromium is installed in `/opt/pw-browsers`; never run `playwright install`. Check that the
repo's Playwright wants the build that directory holds (`chromium_headless_shell-<build>`
against `node_modules/playwright-core/browsers.json`). When they differ, point
`PLAYWRIGHT_BROWSERS_PATH` at a scratch directory holding a symlink named for the build the
repo wants, its `INSTALLATION_COMPLETE` marker and the `ffmpeg` directory, rather than
changing the repo's Playwright version.

A screenshot script sits inside `clients/poolmaster`, so it resolves `@playwright/test`, and in
the scratch directory's copy, not committed. Take each screen at a phone width (390) and a
desktop width (1280), signed in as the role whose view it is: the root admin, a commissioner,
or one of the test players.

## Where this goes wrong

- **Pointing the app at `poolmaster_test`.** The next test run empties it.
- **Running the DB-backed test suites against the same database while the app runs.** They
  clean up each other's rows.
- **Committing the scratch files**: `.env`, screenshot scripts, the browser symlinks.
- **Showing screens with no data.** An empty leaderboard proves nothing; load the sport with
  test players first.
- **Sharing a generated password.** It is for this container only; leave it out of messages
  and files.
