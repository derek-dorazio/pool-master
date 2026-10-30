# PoolMaster — UX Rules

These rules guide first-draft UX decisions for the PoolMaster web app.

They exist so frontend implementation uses standard, conventional UX patterns by
default instead of improvising layout, control hierarchy, state communication,
or status treatments slice by slice.

This file should evolve as PoolMaster-specific product decisions are reviewed
and refined.

## Source Bias

PoolMaster should prioritize consumer-product UX conventions over enterprise
business-app defaults.

Reference influences for these rules:

- shadcn/ui composition patterns
- Radix primitives interaction and accessibility conventions
- Material UI / Material Design control hierarchy and state conventions

Use those conventions as the starting point, but bias toward a consumer app:

- identity-rich surfaces
- clear empty states
- lighter, more welcoming navigation
- less dense enterprise-style controls
- cards, sections, and guided flows before admin-style tables where possible

## 1. Default UX Behavior For First Drafts

- Use standard web UX conventions unless an active plan says otherwise.
- UX proposals must be grounded in current product truth before they are
  grounded in visual precedent.
- Do not treat archived screens, old wireframes, or broad API capability as
  proof that a field or control belongs in the current feature.
- Prefer familiar layout, button placement, navigation, and state treatments
  over clever or novel interaction patterns.
- When product intent is clear but micro-UX details are not, choose the most
  conventional first draft and surface the assumption in the implementation
  summary.
- Ask follow-up questions only when the UX choice would materially affect
  architecture, data model, or the user journey.

## 2. Action Hierarchy

- Each surface should have one clear primary action.
- Secondary actions should be visually quieter than the primary action.
- Destructive actions must be visually distinct from ordinary secondary actions.
- Follow a conventional hierarchy similar to Material-style button treatment:
  - primary action = strongest emphasis
  - secondary supporting action = outline/subtle emphasis
  - tertiary action = text-style or quiet action
- Button labels should use clear verbs:
  - `Create league`
  - `Join league`
  - `Log out`
- Avoid ambiguous labels like:
  - `Continue`
  - `Submit`
  - `Save changes`
  unless the surrounding context makes the action completely obvious.

## 3. Placement And Layout Conventions

- Keep header controls concise and scannable.
- Compact header controls should prioritize identity first:
  - league avatar/icon
  - league name
- Menus should contain quick actions or quick switching, not miniature pages.
- Dialogs should stay focused on a single task with clear primary and secondary
  actions.
- Do not overload compact selector rows with extra icons or multiple competing
  status indicators when space is tight.
- In constrained navigation components, use subtle visual treatment for status:
  - muted tone
  - background shading
  - text treatment
  - small status copy only when space allows
- Richer status presentation belongs on larger surfaces such as:
  - grid cards
  - list tiles
  - settings/manage pages
  - full league detail/home panels
- Prefer card/list/tile layouts for consumer league browsing before reaching
  for tables. A list that can run to hundreds of rows (teams, owners, standings)
  is the exception: §12 rule 7.
- Every page works in a phone's browser at 320px wide (iOS Safari and Android
  Chrome; there is no native app yet). No page may be wider than the screen:
  a row of controls wraps or scrolls inside its own box, and a wide table
  scrolls inside its own box rather than widening the page. Shared pieces carry
  the phone sizing, so a feature rarely needs its own: form fields are 16px on
  phones (iOS Safari zooms in on anything smaller), cards and the page shell
  use less padding below `sm`, and dialogs size to `dvh`, not `vh`.
  `phone-layout.e2e.ts` checks the main commissioner path at 390px, and the
  league home and Create contest at 320px.

## 4. Active And Inactive State Rules

- Distinguish clearly between:
  - inaccessible
  - inactive
  - empty
  - loading
  - error
- If an entity still exists and the user can access it, prefer rendering the
  real page in read-only mode over redirecting to a different page.
- Inactive state should be communicated first at the page level:
  - banner
  - status panel
  - disabled action explanation
- Do not rely on disabled controls alone to communicate inactive state.
- Do not rely on color alone to communicate active/inactive state.
- When controls are disabled, provide nearby explanatory text so the page does
  not feel broken.

## 5. Menus, Selectors, And Navigation

- Dropdowns and selectors should optimize for fast recognition and low visual
  noise.
- Compact selector rows should generally show only the minimum identity data:
  - icon/avatar
  - name
- Follow Radix/shadcn menu conventions:
  - grouped actions when categories differ
  - separators when action meaning changes
  - submenus only when clearly necessary
- If a status marker is needed in a compact selector, prefer subtle row-level
  treatment over adding another icon unless the reviewed design explicitly
  chooses otherwise.
- Navigation items should remain stable across states when possible; avoid
  moving controls around between active and inactive pages unless the page model
  truly changes.

## 6. Page-Level State Communication

- Use a page-level message when a whole surface is inactive or read-only.
- Use inline helper text when only one section or action group is affected.
- Preserve the main structure of the page when the page is still meaningful in
  read-only mode.
- Read-only state should preserve understanding first, then explain why actions
  are unavailable.
- Error states should explain recovery actions:
  - return to welcome
  - use league selector
  - retry

## 7. Forms And Validation

- Show validation close to the field that needs attention.
- Prefer inline validation and clear helper text over vague banner-only errors.
- Pending states must be visible:
  - disabled submit
  - loading text
  - spinner only when it adds value
- Preserve consistent button ordering within the same modal or form pattern.
- For modal tasks, keep the primary action in the predictable confirmation
  position and keep cancellation visually quieter.

## 8. Accessibility Expectations

- Do not rely on color alone to signal status or interactivity.
- Keep semantic controls and keyboard accessibility intact.
- Icon-only actions require an accessible name.
- Disabled or read-only states should still remain understandable to assistive
  technology users through visible copy and control semantics.

## 9. PoolMaster-Specific UX Guidance So Far

- The product's name on screen, in the browser tab, in every email and in link previews is
  `PRODUCT_NAME` ("Primetime Commissioner"), with `PRODUCT_TAGLINE` under it, both in
  `packages/shared/domain/brand.ts`. Copy reads them rather than typing the name, so a rename
  is one edit; that covers code comments too, which say "the product". `rules:check:brand-copy`
  fails when either string is typed out in tracked source outside `brand.ts`; tests and
  markdown are exempt. A link preview image draws the name into a committed picture, so a rename
  re-renders those (the `update-pictures` skill). `poolmaster` stays the name of code, packages,
  infrastructure and the repository.
- **Repeated words come from one place.** A button or call to action that reads the same on
  several screens comes from its feature's copy file (the event pages' `EVENT_PAGE_ACTIONS`),
  and a loading spot with nothing specific to say uses `LOADING_TEXT` or `LoadingState`'s
  default. Loading text ends in three dots, "Loading members...", never the single "…"
  character. Other screen text stays inline in its component; the site is English only and
  has no translation layer.
- The header league switcher is the only way to move between leagues — there
  is no separate "My Leagues" grid/list page. Keep the switcher compact:
  - league avatar/icon
  - league name
- If commissioner-visible inactive leagues need special treatment in the
  compact selector, start with subtle row styling rather than another status
  icon.
- Richer per-league status (active/inactive indicator, counts) belongs on
  **League Home** (`/league/:leagueCode`), the league's landing page; the
  league's settings and lifecycle actions belong in Commissioner tools. See §12
  and `requirements/product-requirements/navigation-and-entry-points.md`.
- Member inactive-league experience should emphasize, on League Home itself:
  - same league home
  - read-only state
  - clear explanation
  - `Message commissioner` as the future-oriented next step

## 10. Frontend Persona Requirement

Apply these rules by default when preparing the first implementation draft.

That means:

- make conventional UX choices proactively
- explain important UX assumptions after implementation
- suggest best-practice options when a design detail is still open
- avoid punting ordinary layout and control decisions back to the user unless
  the tradeoff is genuinely product-shaping

For product-manager and UX-design work before implementation:

- verify the active domain/contract inputs first
- prefer current source-of-truth fields over archived design precedent
- if a design review uncovers a stale contract or model signal, surface it as a
  cleanup issue instead of normalizing it into the proposed UX

## 11. What To Avoid By Default

Unless a reviewed product requirement calls for it, avoid these enterprise-leaning
defaults in first drafts:

- dense admin tables as the first representation of consumer-facing content
- icon overload in compact navigation surfaces
- multiple competing primary actions in one panel
- status communicated only through tiny badges with no surrounding explanation
- hiding useful read-only information just because editing is unavailable

## 12. League Pages and Commissioner Tools

Every league-scoped page follows these rules, and so does any later
administration area (root admin included), reusing the same shared components.

1. **Two areas.** The member area is what everyone in a league uses.
   Commissioner tools is a separate area that only commissioners, and root
   admins looking at the league, can open. No commissioner-only control appears
   in the member area: a commissioner acts as a member most of the time.
2. **One league menu.** Member pages share one menu under the app bar (Home,
   Contests, Championships, Contest types, the viewer's own squad by its
   name — **Yours** until they have one — and Members; `LeagueMenu`). Commissioners also see a
   Commissioner tools button at its right end. The league selector stays in the
   app bar. An administration area has its own header with a way back and a side
   menu (`AdminAreaLayout`) instead of the league menu. Each of its pages has one
   heading: the area titles the page, or an entity's landing page shows its
   `IdentityHeading`. A page never adds a second header or "Back to" link of its
   own; the trail leads back up.
3. **Compact identity, once.** An entity's icon, name and shareable code appear
   once, as a compact heading (`IdentityHeading`) on its landing page. No page
   repeats them as an editable detail panel.
4. **Full pages, not dialogs.** Editing and managing are full pages with their
   own route, so Back and links work (`FormPage`). Dialogs are only for
   confirming a destructive or irreversible action: inactivate, delete, leave,
   remove.
5. **One edit for all properties.** An entity's editable properties are edited
   together on one form page with one Save, never a dialog per property.
6. **Danger zone.** Destructive actions sit in their own marked section at the
   bottom of the settings page (`DangerZone`), each with a confirm step, never
   beside everyday actions. Settings themselves are shown as labelled rows
   (`SettingsSection`, `SettingsRow`) with one Edit for the group.
7. **Lists scale.** Member, owner and leaderboard lists have search and paging,
   assuming hundreds of rows: tables through `DataGrid`, other lists through
   the same `Pager`. A long ranked list also offers a way to jump to the
   viewer's own row (`DataGrid`'s `jumpToRow`). Summary cards show a few rows and link to the full page.
8. **Summary first.** A landing page leads with what needs the member now (the
   next contest to enter, with its cutoff), then live standings, then their own
   squad.
9. **One header per entity's pages.** Pages that show one entity from
   different angles share one header and a segmented sub-menu between them,
   not "Back to" and "View" links on each page. A contest's pages share
   `ContestPageFrame`: Entries, Leaderboard once picks are revealed, and My entry
   once the viewer has one. A contest leaderboard is built from the leaderboard
   kit in `features/contests` (`LeaderboardFrame`, `ScoreboardGrid`, the Place,
   Entry and total columns, and `YourBestNote` for the viewer's best entry) and
   defines only its own columns and notes; the viewer's own rows, here and in
   cup tables and league home, carry the one `MineMarker` ("Yours"). A squad
   standings table (a cup's, a championship's finish matrix) is a
   `SquadStandingsGrid` in `features/championships` that starts from the shared
   Place, Squad and Points columns. An entry page opens on its picks: the entry's status
   is an icon beside its name (`ContestEntryFrame` draws it with
   `EntryStatusCallout`, with the status, the contest's phase and the entry's
   dates in a callout on hover or tap), not badges and a details panel above
   the picks, and the entry's name, its tiebreaker and the one Submit for the
   whole entry come after the picks. A team or tie to pick in a pick'em,
   survivor or bracket game is a `PickOption` (pressed and marked "Your pick",
   "Used" for a spent survivor team), and a `PickedLine` once picks lock. An
   event's pages in Manage share `SportEventHeader` whatever its sport:
   Overview, Field, Tiers, and the results page its scoring family names
   (Scores for golf, Results for a race, Bracket for a knockout tournament).
10. **Actions are named for what they do, never "draft".** "Draft" is a contest
    status and also the snake-draft selection type, so no button or link uses
    it as a verb or noun: **Create contest**, **Save**, **Delete contest**,
    **Open to league**, **Finish setup**. The status label itself stays as
    `contestStatusLabel` gives it. A list row has one action naming the next
    step (Finish setup before a contest opens, Manage after).
11. **Formats and tiers in plain words.** A contest's format is its name
    ("Tiered", from `formatSelectionTypeName`) and its rules one sentence
    (`formatContestRules`), never raw enums such as `TIERED · STROKE_PLAY`. An
    event's tiers read **Tier 1**, **Tier 2**, … from `tierNumber`, one per
    row with Tier 1 on top.
12. **Contest templates name and sell each contest.** Create contest offers a
    league's contest templates as choices by their own `name` and
    `description`, so both are product copy. A name reads
    `<Format>: <how you pick>, <how it scores>`, the format named as
    `formatSelectionTypeName` names it ("Tiered: 1 golfer per tier, best 4
    count", "Bracket: full bracket, doubling + upset bonus"), with digits, the
    sport's own noun (a Clutch Card's setups call their players stars:
    "Tiered: 1 star per tier, best 4 count"), under 60 characters and no full
    stop; a template covering several events puts its scope after the format
    ("Tiered majors pool: …"). A Clutch Card contest itself is named "<event>
    Stars", which Create contest suggests whatever its format.
    The description is one or two plain sentences of at most 220 characters,
    how an entry picks and then how it scores, with no setup words (template,
    preset, config). Every sport league has exactly one default for each format
    it can host on each kind of event it plays (`ContestTemplateEventType`:
    a knockout, or a week of a season's games), so setup never starts blank; a
    variation is added only where there is something to vary (an upset bonus,
    a second-chance bracket), never for its own sake. A league starts on the
    format whose default sorts first. The seeded-template integration test
    checks all of it. The same names and descriptions are the contest types
    menu (#803): the public How to Play page shows each way to play once, as an
    illustrated card, with chips naming the sport leagues people know (the NFL,
    the PGA TOUR), in one row per sport with the sport in a fixed left column,
    that narrow it to one league or sport and show the sport's picture and line
    and the league's default templates (#878). The Clutch Card is one more card
    among them, shown while a shown league is a stat pool's: its line and steps,
    each sport's stat line (Box Score, Redzone) as a small tile, and a link to
    `/play/clutch-card` for the rest; no per-league formula list. An open card
    offers Create contest to a signed-in viewer who runs an active league, on
    the shown league's default (with every sport shown, the most popular sport's
    first league's), asking which league when they run several (#1104). Sports run most popular first
    (`SPORTS_BY_POPULARITY`, cycling and running last), and each sport's leagues
    by their `displayOrder`: major professional leagues first, then the NCAA's.
    A league whose name alone doesn't say the sport ("NCAA Division I Men") gets
    a `displayName` with its reference data, and every seeded league gets a
    `displayOrder` there (the seeded-template integration test checks it); a league's Contest
    types page shows every sport league's tiles, with "Create this contest"
    links for its commissioners. Both read the templates, so a new template or
    sport shows up there with no copy change. The hand-written parts are
    records the typecheck enforces: each sport's picture in
    `illustrations.tsx`, each way to play's picture there and its guide in
    `FORMAT_GUIDES`, and one line per sport (`SPORT_BLURBS`). That
    line names the sport's leagues and formats, and nothing fails when it falls
    behind, so a slice that adds a sport, a sport league or a contest template
    rewrites its sport's line in the same PR and reads both pages for that
    sport before review: every league and format it added appears, and the
    line still describes what the sport offers.

## 13. Event Pages

An event page (`/play/<sport>/<slug>`) is the public page for one event a fan would name
(Championship Weekend, the Super Bowl), whatever sport leagues and series run it. It is the
landing page that ads, emails and shared links point at.

`/play/clutch-card` sits beside them: the Clutch Card's own page, one contest type across
every title round. It follows the same copy and button rules, and shows a round as available
only while that round's stat pool sport league is active, linking it to the event page that
offers it.

1. **Hand-picked, not generated.** A page exists because someone chose it: its row and its
   offers are reference data in a migration (`rules/architecture-rules.md` §6 *Reference data
   goes in a migration*). Each offer is one contest setup (a template, found by its key in its
   own sport league) on one series of that league, with an optional bracket starting round. One
   offer is the primary, whose edition dates the page.
2. **Each offer opens on its own.** An offer shows open, or "opens soon" with when, from Create
   contest's own checks on the series' next edition; one with no edition left is left out. A
   page's words never claim an offer is open.
3. **A stat pool covers one playoff round.** A Clutch Card offer is on a sport league whose
   events are one round (Championship Weekend's two games, then the Super Bowl's one), never
   several, so a round people pick separately gets its own page. A bracket offer is the
   exception by nature: it runs from its starting round to the final.
4. **Words live in the web app.** A page's name, eyebrow, hook line, when picks close, the
   league named in its "not affiliated" footer, and each offer's card (contest type, one line,
   two facts, when it opens) are in `EVENT_PAGE_COPY`, keyed by sport and the page's stored
   slug. A page without copy still renders, its name from the slug, its hook from its sport's
   How to Play line and each card from the selection type's name and the template's
   description, but a page ships with copy.
5. **Real names on our pages, generic names in ads.** Our pages name the real event. Copy
   anywhere, ads included, never says "fantasy", "bet", "odds", "props", "win cash" or "prizes",
   and never shows league or team logos or player photos.
6. **Every page with copy has its link preview.** Its 1200 by 630 image is committed in the web
   app's `public/og/`, drawn from the tile layout by `scripts/render-link-preview-images.mjs`
   and kept small enough for WhatsApp (about 300 KB); a unit test fails while one is missing.
   The deploy writes the page's shell with its Open Graph tags, and CloudFront serves it only
   to link-preview crawlers. Search crawlers and people get the app.
7. **The hero shows the sport's photo.** A page opens with its sport's 1200 by 480 header
   image, the same file the email about its events uses (`sportHeaderImagePath`), so one photo
   per sport serves both and a new sport's photo arrives with its email header. No other
   in-app page carries these photos: setup and league pages stay compact.
8. **Addresses are forever.** A slug is never changed or reused, because it lives in emails,
   ads and other people's chats. A page that ends is made inactive, and may redirect to the
   page that replaces it.

## 14. System Email

The emails the app sends are typed renderers in `system-email-templates.ts`, built from shared
pieces so every email draws the same thing the same way. How they are sent, previewed and
tested is `docs/EMAIL-DELIVERY.md`; this section is what an email looks like and may say.

1. **The brand bar opens every email.** `PRODUCT_NAME` with `PRODUCT_TAGLINE` under it on the
   left (§9), and the league's name on the right whenever the email comes from a league. There
   is no other masthead, so the email's own subject is the first thing read.
2. **One header for what the email is about.** An email about one event opens with its event:
   the full header (the sport's picture, then a navy band with the sport league, the email's
   title, the event's name and its day) on the emails that start something (coming up soon,
   ready for contests, new contest, contest is live), and a strip (a small crop beside the band)
   on the ones that follow up (picks close soon, standings, receipts, event changed). Final
   results open with a trophy band naming the winner, or every winner on a tie. The weekly
   digest has the brand bar only, with a small crop of each event's sport picture beside its
   row. Every other email has the brand bar only. The event's name sits in the band, never in
   the picture, so the email still reads when a mail client blocks images.
3. **One gold button per email**, for the one thing it wants done. Other links are plain text.
4. **Shared pieces, not one-offs.** A default contest setup offered to a commissioner is a tile
   (its way to play's How to Play picture, the format, the setup and its description, the whole
   tile one link, one tile per row). On the email the commissioner acts on (Ready for contests)
   a tile prefills Create contest with the setup and event and never creates anything; before
   the event is released (Coming up soon) it links to the event's page, else the league's
   contest types page. One contest is a contest card (its format's picture, name, rules,
   entry limit). In any leaderboard the reader's rows are tinted gold and marked "YOU", and the
   reader's best place sits in a callout above the table ("3rd", "T2" on a tie). A new email
   reuses these; a new piece is a renderer beside them, not markup inside one template.
5. **Pictures are ours or generic.** Every picture is a JPG or PNG under the web app's
   `public/email/` linked by absolute URL; never SVG, which Gmail and Outlook do not show. A
   sport's picture is one generic licensed photo for every event of that sport, checked before
   use for logos, sponsor decals, slogans, named venues, readable numbers and recognisable
   faces, with its source and licence noted beside the file. Contest type pictures are drawn
   from the How to Play illustrations, so the two never drift. No league, event or team logo,
   no event slogan and no player photo appears in any email. The trademark check before the
   first paid ad or production launch covers these emails too.
6. **Real event names, and the disclaimer.** Emails name the real event, as our event pages do
   (§13 item 5). Every email that names a sport league says in its footer "Not affiliated with
   {league} or any sports league."
7. **Built for mail clients.** Tables with inline styles, no flex, grid or media queries; every
   image has a fixed size, `display:block` and empty alt text. The plain-text twin carries the
   same facts and every link, one line each.
8. **Dates, rarely times.** An email sent days ahead shows only the day. A time, with its zone
   named, appears only when it matters that day: the entry reminder sent less than a day before
   picks close, the commissioner's "contest isn't open yet" email, an event moved within its own
   day, and an email recording when something happened (account emails, entry receipts). It is
   always in the reader's time zone, locale and clock.
9. **The site's type, without its fonts.** The brand bar's `PRODUCT_NAME` is italic caps, as
   the site's wordmark is. Small uppercase labels are label blue on white and navy haze on a
   navy band, as the site's eyebrows are. Email keeps to Archivo and Inter with Arial behind
   them; the site's condensed number face is not used, since most mail clients would fall back.
