---
name: add-event-page
description: Adding an event page (/play/<sport>/<slug>) and its link preview tile — choose the page and its offers, seed them by migration, write the page's copy, draw its preview image, test, and check it on QA. Use when someone wants a landing page for an event such as the Super Bowl or the Final Four.
user-invocable: true
allowed-tools: [Read, Grep, Glob, Edit, Write, Bash]
---

# Adding an event page

An event page is hand-picked: one migration seeds the page and its offers, one entry in
`EVENT_PAGE_COPY` gives its words, and one committed image is its link preview. The policy is
`rules/ux-rules.md` §13 *Event Pages*; read it first. The page needs no new code, so a slice
is a migration, a copy entry, an image and their tests.

## Step 1 — settle the page with the user

Write this table in the ticket, each open point a question with a recommendation:

| Decision | What to settle |
|---|---|
| Event | The event a fan would name, and which sport it is under |
| Slug | Lower case words joined by single dashes (`super-bowl`). Permanent: it lives in emails, ads and chats |
| Offers | For each way to play: the sport league, the series its editions are loaded as, the template key, and a bracket starting round if it starts later than the template's |
| Primary | The one offer whose edition dates the page, usually the stat pool or the one that opens first |
| Order | `display_order` among the sport's pages: the calendar order of their events |
| Copy | Name, eyebrow, hook line, when picks close, the league in the footer, and each offer's card |

Check each offer before writing anything:

- The template exists, is active, and belongs to that sport league. Find it in the contest
  template reference migrations by its key. The offers insert joins the template to its league,
  so a template with no league seeds no offer.
- The series name is exactly what the sport league's data files load its editions as. An offer
  on a series with no upcoming edition is simply not shown, so a typo fails silently.
- The page's hero is its sport's photo (`rules/ux-rules.md` §13 *Event Pages* item 7), already
  in `clients/poolmaster/public/email/sports/`. A sport without one shows its drawn How to Play
  scene; a better photo is a separate change, with its source note beside it, and can show the
  old one for up to a day while caches expire.
- A stat pool offer covers one round (`rules/ux-rules.md` §13 *Event Pages* item 3). An event
  whose stat pool league does not exist yet needs that league first (the `add-clutch-card-league` skill).

## Step 2 — the migration

Reference data, so `rules/architecture-rules.md` §6 *Reference data goes in a migration*
applies: idempotent on the natural key, never an edit to an applied migration.

1. Name it after main's latest migration (`ls packages/core-api/prisma/migrations | tail -3`
   on a fresh `origin/main`), with a timestamp no other open branch is using.
2. Insert the page `ON CONFLICT ("sport", "slug") DO NOTHING`.
3. Insert the offers from a `VALUES` list joined to `sports`, `sport_leagues` (by name) and
   `contest_config_templates` (by key and league), as the Championship Weekend migration
   (`*_event_pages`) does, `ON CONFLICT ("event_page_id", "sort_order") DO NOTHING`. Exactly one
   row has `is_primary`; a starting round goes only on a bracket template.
4. Run it on a scratch database with `prisma migrate deploy`, not a reset of the shared one.

## Step 3 — tests for the seed

`tests/integration/core-api/event-pages.integration.ts` already checks every page's slug, its
one primary offer, and that each offer's template is active, the page's sport and its league's.
Add one test for the new page that names its offers in order, by template key and starting
round, so a league or template the joins did not find (and so silently seeded no offer) fails.

## Step 4 — the copy

Add the page to `EVENT_PAGE_COPY` in `clients/poolmaster/src/features/event-pages/event-page-copy.ts`,
under its sport and slug, with every offer's card keyed by its template key. Write the cards in
the offers' `sort_order`: the preview image's chips follow the copy's order, so the image and
the page then agree. Follow
`rules/ux-rules.md` §13 *Event Pages* items 4 and 5 for what the words may say. Read the
page on a local build with the API running to see the cards in order.

Every event page renders through the one event page component, so a new page is copy and seed
data only. A page that needs a layout of its own, as the Clutch Card page does, is built from
the kit in `clients/poolmaster/src/features/event-pages/components` (start button, section,
photo hero, sticky start bar, next-up card, disclaimer) and the shared `NumberedSteps`,
`FaqList`, `ExpandableTile` and `Countdown`. It is never copied from another page.

## Step 5 — the preview image

From `clients/poolmaster`, run `node scripts/render-link-preview-images.mjs`. It redraws every
page's 1200 by 630 JPEG into `public/og/` from the copy; commit only the new or changed page's.
Open the image and read it: name, hook and chips must fit without wrapping off the card. The
script loads its fonts from Google Fonts, and without them it draws in fallback fonts, so look
before committing. Keep it under about 300 KB. `link-preview.test.ts` fails while a page with
copy has none. Redrawing it later, and the other pictures, is the `update-pictures` skill.

## Step 6 — gates, PR, QA

Run the `release-check` skill. After the merge, the QA deploy writes the page's shell on its
own; no Terraform apply is needed. Then check:

```bash
curl -s -A "facebookexternalhit/1.1" https://qa.ultimateofficepoolmanager.com/play/<sport>/<slug> | grep og:title
```

and paste the link into Slack or iMessage. An offer shows only while its series has an edition
on QA that is not over: load that series' test seed or its real schedule with the
`load-sport-data` skill, then read the page.

## Traps

- **An offer that seeds nothing.** The offers insert joins by league name and template key, so
  a misspelling inserts no row and raises no error. Only the page's own integration test
  catches it.
- **A stale preview image.** The unit test checks that each page has an image, not that it
  matches the copy. Re-run the render script whenever a page's name, eyebrow, hook or offers
  change, and commit the new image.
- **Changing a slug.** Never. Make the old page inactive and point its `redirect_to_page_id` at
  the new one, in a later migration.
- **A migration timestamp another branch also took.** Two migrations on the same timestamp
  break main once both merge. Check the open PRs' migrations, and trial-merge main before merge.
- **Testing a card in a chat that saw the link before.** Chat apps cache a link's card. Add
  `?t=1` to see the new one.
- **Offers missing on QA.** An offer is left out while its series has no edition that is not
  over. A test seed's dates are moved forward when it loads, so loading the series' test seed
  (or its real schedule) brings the offer back; an old load whose dates have passed does not.
