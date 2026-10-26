# Event landing pages and ad tiles

**Tracking issue:** #998

Written 2026-10-24 for Derek's review; every question in *Questions for Derek* answered the same
day. Design only: nothing here is built yet. Mockups (a canvas
of nine boards: desktop and phone landing page, the league picker, How to Play's new row, the
sign-up flow, two Instagram ads, a commissioner email and small tiles):
https://claude.ai/artifact/CEcG4pHJaFiRh29j9rVokC

## What we are building

Derek's brief (2026-10-24): landing pages that "zoom in" from How to Play to one sport league
event, plus small ad tiles that drive traffic to them, for two goals: new league sign-ups, and
new contests in existing leagues. "AFC/NFC Championship week is approaching, create your
Redzone contest today." Ads go out by email blast and Instagram; every click lands on an event
page, which starts registration for a new visitor or contest setup for a commissioner. Derek
added: he is new to marketing, Poolmaster must not become a marketing platform, and he can plug
one in later.

So Poolmaster builds three things and nothing more:

1. **Event pages**, public, one per event a fan would name: `/play/american-football/championship-weekend`.
2. **The hooks** that make a click count: links that carry the chosen contest setup and event
   into sign-up, league creation and contest setup, plus tracking tags that survive the trip.
3. **A tile template**: one fixed layout per event page for emails, How to Play and ads.

Campaigns, ad buying, audiences, A/B tests and promotional email blasts are run in outside tools
(*Marketing primer* says which kind). Poolmaster's existing commissioner event emails (#845) are
the one exception, because they already exist and already go to the right people.

## Marketing primer

The ideas that matter for this, in plain words, each with what Poolmaster does now and later.

| Idea | What it means | Now | Later |
|---|---|---|---|
| **Funnel** | The steps from seeing an ad to being a happy user: see → click → land → start → sign up → league → contest → invites → entries. Each step loses people; you fix the leakiest step first. | Design every page so the next step is one obvious button. | Measure each step (*Conversion tracking*). |
| **Landing page** | The page an ad click arrives on. It does one job: get one action. It repeats the ad's promise in its headline, so the visitor knows they are in the right place. | The event pages. One main button, no menus to wander into. | Variants per audience if numbers say so. |
| **CTA** (call to action) | The button. One per screen, verb first, says what happens: "Start a free league", "Set up Clutch Card". | Used throughout the mockups. | — |
| **Message match** | The ad, the page headline and the first screen after the click use the same words and picture. A mismatch is the most common reason people bounce. | Tile and page share the event name, hook line and contest types. | — |
| **Seasonality** | Sports demand spikes before big events. Ads start 2 to 3 weeks before; commissioner emails go about 10 days before (C1) and when the event opens for contests (C2). | *Event calendar* below. | Put the calendar in the marketing tool. |
| **UTM tags** | Labels added to a link so you know where a click came from: `?utm_source=instagram&utm_medium=paid&utm_campaign=championship-weekend-2027&utm_content=square-a`. Every analytics tool reads them. | Event pages keep them through sign-up (Q4). | — |
| **Conversion tracking** | Counting how many visitors reach each funnel step, split by UTM tag. Tells you which ad paid off. | Nothing yet: deferred (Q4). Links carry UTM tags so a tool added later can read them. | Store the first UTM on the user if a report needs it. |
| **Activation** | The moment a user gets value. **Defined here, once:** a contest on one of an event page's editions with at least two squads entered. A sign-up that never gets there is not a win. | The last of Q4's goals. | Nudge emails for leagues that stall. |
| **Pixels and consent** | Ad networks (Meta for Instagram) offer a "pixel" script that reports conversions back to them, so their ads target better. It sets cookies, which in places like the EU needs a consent banner. | No pixel (Q4). | Add Meta's pixel plus a consent banner when paid ads spend enough to need it. |
| **Email consent** | US law (CAN-SPAM) allows promotional email to people who signed up for a service, as long as it is honest and has a working unsubscribe. EU and Canada need opt-in. Event emails to commissioners are a feature; "start your own league" to members is promotion. | Commissioner event emails stay as they are. | A "News from Poolmaster" category, sent from the marketing tool (Q5). |
| **Referral loop** | Every user who invites friends is free advertising. For pools this is the biggest channel: one commissioner brings 10 to 50 people, and some of them run their own pool next year. | Nothing new: invites already spread the product. | A "Run your own pool" link on invite and join pages (*Later*, below). |
| **SEO** | Getting found on Google for "office pool for championship weekend". Needs pages Google can read, with a title and description per event. | Event pages are public and get their own title and description. | Prerendered pages if Google won't index them well. |
| **Link previews** | When a page link is pasted into iMessage, WhatsApp, Slack or Instagram, the app fetches the page's "Open Graph" tags to draw a card. Without them a shared link looks broken. This matters more than SEO for pools, which spread by group chat. | Q6. | — |
| **A/B test** | Show two versions to different visitors and keep the winner. Only worth it with a few hundred visits a week. | Keep headline and hook copy in one place per page so a variant is cheap. | Run in the marketing or analytics tool. |

## Event pages

### What one page is

A fan's "event" does not map to one series. Championship Weekend is three things in the model:

- **Clutch Card** runs on the *Championship Weekend* sport league, a player-stats league with
  one event a season (`plans/championship-stat-pools.md` §3).
- **Bracket** and **Squares** run on the *NFL* sport league's `NFL Playoffs` series, one
  knockout event. Squares takes one game of it; a bracket can start at a later round once the
  knockout is under way (#721, "second-chance bracket").
- **Pick'em does not apply.** Pick'em templates are offered only on `WEEK` events (regular
  season weeks, #802), and no playoff-round Pick'em exists. The first draft's Pick'em card was
  wrong; the mockups now show a Bracket from the conference round instead.

So **an event page is a curated grouping**, not a series. Each page is reference data with a
list of *offers*; each offer names one contest setup on one series:

| Table | Columns |
|---|---|
| `event_pages` | `id`, `sport`, `slug` (unique per sport), `display_order`, `is_active`, `redirect_to_page_id` (null) |
| `event_page_offers` | `event_page_id`, `sport_league_id`, `event_series_name`, `template_id` (FK to `contest_config_templates`; a template key alone is not unique), `bracket_start_round` (null), `sort_order`, `is_primary` |

Championship Weekend's offers: Clutch Card *Championship Weekend Stars* on the Championship
Weekend league (primary: its dates head the page); the NFL playoff bracket from round 3 on
`NFL Playoffs`; NFL Squares on `NFL Playoffs`, where the commissioner picks one of the two
conference games. The Super Bowl page: *Super Bowl Stars* on the Super Bowl league (primary) and
NFL Squares on `NFL Playoffs` (the final).

Rows are seeded in migrations, like contest templates, so every environment has the same pages.
A root admin page to edit them can come later if pages change more than a few times a year.

### Slugs and URLs

- Path: **`/play/:sport/:pageSlug`**, for example `/play/american-football/championship-weekend`. The
  sport segment is the existing sport path segment (`sportPathSegment`), so `ncaa-...` slugs can
  repeat across sports without clashing.
- **Slugs are stored, never derived.** The web app reads them from the API and never computes
  one, so web and API cannot disagree, and renaming a sport league, series or template changes
  no URL. A shared `isEventPageSlug` pattern in `packages/shared` (lower case, digits, single
  dashes) is checked by the DTO schema and by an integration test over the seeded rows.
- **Evergreen**: the URL names the page, not the year, so an ad, an email or a Google result
  keeps working every year.
- **Retiring a page** sets `is_active = false` and, when there is a successor,
  `redirect_to_page_id`; the old URL then redirects. An inactive page with no successor shows
  "This page has moved" with a link to How to Play. Old ad links never 404.

### What the API returns

- **Public read** `GET /event-pages/:sport/:pageSlug`: the page's sport and slug, and for each
  offer, in order: the sport league, the template (id, selection type, name, description), the
  bracket start round, and the series' **next edition**: the one in progress, else the soonest
  upcoming. Each offer carries one of three states:
  - `OPEN`: Create contest would accept it now (edition released; for a later-round bracket, the
    knockout is under way).
  - `NOT_YET`: an upcoming edition exists but cannot take contests yet; the card shows when it is
    expected ("Opens when the four teams are set"), from the edition's start date.
  - No upcoming edition: the offer is left out. A page with no offers left says when it is next
    expected and lists what else is coming up.
- `GET /event-pages?sport=` lists the active pages with their primary offer's next edition,
  for How to Play's row and the "Next up" strip.
- Both are public and carry no league or user data (`rules/architecture-rules.md` §2
  *Contract-First API Architecture*). They take path params, so they need entries in the auth
  guard's public route patterns and in `scripts/route-authorization-opt-outs.mjs`, with the
  reason (`rules/service-rules.md` §3 *Fastify Module Structure*).
- **Copy lives in the web app**, as all product copy does: a small registry keyed by page slug
  holding the hook line ("Four teams, two games, one Sunday"), the eyebrow and the ad-safe short
  name, like `sport-blurbs.ts`. A page with no registry entry falls back to its sport blurb.

### Page, top to bottom (boards 1 and 2)

1. Header as `/plans`: How to Play, Plans, Sign in, Start free.
2. Breadcrumb back to How to Play at that sport.
3. Hero: eyebrow, event name, hook line, the primary offer's date and "Picks close at the first
   kickoff" from the contest rules, the main button and the gift pill ("Every new league gets
   Premium free for a 6-month preview period", length from config).
4. **Ways to play**: one card per offer. Each card names the contest type, the setup it starts
   as, one plain line on how it plays, two facts, and its own button; a `NOT_YET` offer shows
   when it opens and "Start your league now, we'll email you". A new contest type gets a "New"
   badge.
5. **Ready before kickoff**: three steps, the same as How to Play's.
6. **Next up**: the sport's next event page, linked.
7. Footer: "Not affiliated with the NFL or any sports league."

On a phone a slim bar with the main button stays at the bottom of the screen once the hero has
scrolled away.

### How to Play zooms in (board 4)

How to Play with a sport chosen gains a **Coming up** row above its ways to play: one card per
active event page of that sport whose primary edition is upcoming, with when, the contest
types, and a link. With no sport chosen, it shows the next three across all sports. The welcome
page shows the same row, so a signed-in user sees what's next.

## The two audiences

Every button on the page goes to one signed-in route,
`/start?page=<id>&template=<id>&event=<id>[&startRound=<n>]`, which decides where the visitor
belongs. A signed-out visitor goes through sign-up first (today's `from` return path), so the
route is the same for everyone (board 5).

| Who | What happens |
|---|---|
| Signed out, new | Sign-up form with a banner, "You're starting a Championship Weekend pool". Then Create league (today's form, with "Next: your Clutch Card for Championship Weekend"). Then Create contest prefilled. Then Invites. |
| Signed out, has an account | "Sign in" on the sign-up screen, then as a signed-in visitor. |
| Signed in, a commissioner of no league | Create league, then as above. |
| Signed in, a commissioner of one league | Create contest in that league, prefilled. |
| Signed in, a commissioner of several | The league picker (board 3), then Create contest in the chosen league. |
| Signed in, only a member | The picker lists none of their leagues; it offers "Start a new league" and "Share this page with your commissioner" (Q3). |

- **"Runs a league" means holds the `COMMISSIONER` role in it** (co-owners are commissioners
  too). The picker lists only those leagues, and every path ends in that league's own Create
  contest page. Leagues are tenants: nothing is shared between them.
- **Prefill, never create.** Create contest already takes `?template=`; it gains `?event=` to
  start on that edition and `?startRound=` for a later-round bracket. The contest exists only
  when the commissioner presses Create contest, so leaving halfway leaves nothing behind.
- **Not open yet.** `/start` re-reads the offer's state. When it is `NOT_YET`, a new visitor
  still gets their league, and lands on the league's home with a card: "Championship Weekend
  opens for contests when the four teams are set. We'll email you." A signed-in commissioner
  sees the same card on the chosen league's home instead of Create contest. The email that
  brings them back is C2, "Ready for contests", which every commissioner already gets when the
  event is released (or the Monday digest, for leagues that chose it). No new reminder is built.
- **The picker says why a league can't**: a league that already has a contest of that type on
  the edition shows "View"; one whose plan has used its sports leagues for the year shows "See
  plans" (#947 caps), never a dead end.
- **The choice survives sign-up** in the route's query string, not in storage, so a refresh or
  a second tab keeps it.

## Ads and tiles

- **One tile layout** (board 9): eyebrow (when), event name, hook line, contest types, button.
  Sizes: 300x250 for emails and in-app; 1080x1080 Instagram feed (board 6); 1080x1920 Instagram
  story (board 7), with the top 250 and bottom 340 pixels kept clear for Instagram's own
  buttons.
- **Poolmaster does not render ads.** The canvas is the template; ads are made in a design tool
  (Canva or similar) from it. A root-admin preview page that draws the tile for a page is
  possible later if making them by hand gets old.
- **Copy rules for every ad**: no "fantasy", "bet", "odds", "props", "win cash" or "prizes";
  no league or team logos, team names or player names and photos; "Not affiliated with any
  sports league" on the creative. Meta reviews ads for gambling, and those words get an ad held
  or rejected.
- **Trademarks**: paid ads use generic names ("the big game", "bracket season",
  "Championship Weekend"); our own pages use real event names, as the app already does (Q2).
- **Every ad link** is the event page plus UTM tags. A naming convention keeps reports
  readable: `utm_campaign=<page-slug>-<year>`, `utm_source` the place (instagram, email),
  `utm_medium` paid, email or social, `utm_content` the creative.

## Email (board 8)

Derek's example, "create your Redzone contest today", is what the commissioner event emails
(#845, `commissioner-notices.ts`) already do. As built:

- **C1 "Coming up soon"** about 10 days before an event starts, to every active commissioner of
  every active league.
- **C2 "Ready for contests"** once the event is released and starts within 7 days; it skips a
  league that already has a contest on the event. A sport league of weeks is told only about its
  first week.
- Both list the event's default contest setups and link each to Create contest in that league
  with `?template=` (`buildCreateContestUrl`).
- **C4** goes 48 hours before picks close, only for a contest still in draft. It is unrelated
  to event pages and stays as it is.
- Leagues whose commissioners chose the **weekly digest** (#851) get the Monday digest instead of
  C1 and C2.

So the commissioner "blast" needs no outside tool. What is new is small: C1 and C2 add the tile
as their header and `&event=` to each Create contest link, and, when the event belongs to an
event page, a "See every way to play" link to it. The digest lists many events, so it gets no
tile; each of its event lines links to its event page when there is one. Promotion to people who
don't run a league (members, lapsed users) is a different kind of email and waits for the
marketing tool and the consent decision (Q5).

## Event calendar

The events worth a page and a campaign, in order from now. Ads start 2 to 3 weeks before; C1
goes about 10 days before and C2 when the event opens for contests.

| When | Event page | Offers |
|---|---|---|
| Mid Jan | NFL Playoffs | Bracket, Survivor, team rosters, Squares |
| Late Jan | Championship Weekend | Clutch Card, Bracket from the conference round, Squares |
| Early Feb | Super Bowl | Clutch Card, Squares |
| Mid Mar | Men's and women's college basketball tournaments | Bracket, Survivor |
| Apr | The Masters | Golf tiers and budget |
| May | Kentucky Derby, Indianapolis 500 | Racing pools |
| Jun | NBA Finals, Stanley Cup Final | Clutch Card, bracket |
| Jun–Jul | Wimbledon, Tour de France | Bracket, racing |
| Sep | NFL season kickoff | Survivor, Pick'em for the season |
| Oct | World Series | Clutch Card |

## Questions for Derek

Each has a recommendation; a one-word answer per number is enough.

1. **Which events get a page?** Every event in the app belongs to a series, and that includes
   weeks of games ("NFL Week 7", Premier League weeks), so there are hundreds. **Decided (Derek
   2026-10-24):** hand-picked pages only, the calendar's events to start; How to Play stays the
   place to browse everything else. A page takes one migration row plus a line of copy. Derek
   also agreed Championship Weekend offers no Pick'em (Pick'em runs only on weeks).
2. **Event names.** Recommend real names on our own pages (as in the app today) and generic
   names in paid ads ("the big game", "Championship Weekend", not "AFC/NFC"); no logos, teams or
   players anywhere. A short check with a trademark lawyer before the first paid ad is cheap
   insurance. **Decided (Derek 2026-10-24): yes.**
3. **A member who runs no league** clicks the button. Recommend offering "Start your own league"
   and "Share with your commissioner" (copies the page link). Both are useful, and neither
   reaches into the other league. **Decided (Derek 2026-10-24): yes**, both
   buttons.
4. **Tracking.** Recommend a cookieless analytics tool (Plausible, Fathom or similar, about
   $10–20 a month) on public pages and the sign-up path, counting page views by UTM tag and five
   goals: start, sign-up, league created, contest created, activation (as defined in the
   primer). No Meta pixel and no consent banner until paid ads spend enough to need Meta's
   targeting. The privacy page (#921) names the tool before it goes live. Storing the first UTM
   tag on the user waits until a report needs it. **Decided (Derek 2026-10-24): deferred.** No
   analytics tool is chosen or built now. Ad and email links still carry UTM tags, which cost
   nothing and are read by whatever tool is added later.
5. **Promotional email.** Recommend leaving commissioner event emails (C1, C2, digest) as the
   commissioner channel, and adding a "News from Poolmaster" email category, on by default for
   new sign-ups with a clear line on the sign-up form and one-click unsubscribe, sent from a
   product-email tool (Loops or Customer.io) once production is live. Poolmaster's own email
   preferences and suppression list stay the source of truth and are synced to the tool, so
   there is one unsubscribe list, not two that drift. It fits US law, and becomes opt-in if
   Poolmaster ever targets the EU or Canada. **Decided (Derek 2026-10-24):** basic
   notifications only for now: commissioner event emails as they are, plus the tile and event
   page link. No promotional category yet; a real marketing automation tool comes later. The
   event pages are built to stand on their own, whatever campaigns come later.
6. **Link previews.** Recommend building Open Graph tags and one preview image per event page
   before the first ad or email goes out: shared links are Poolmaster's main channel, and a
   single-page app shows no preview without them. The how (prerendered page shells at deploy,
   or a small server route) is decided in the build. **Decided (Derek 2026-10-24): yes.**
7. **Order of work.** After Derek's answers (2026-10-24), four slices, all before production, so
   the pages are ready for Championship Weekend in late January once production is live:
   (a) `event_pages` tables and seed rows, the two public reads, the event page, How to Play's
   and the welcome page's Coming up row;
   (b) `/start`, the sign-up banner, the league picker, `?event=` and `?startRound=` on Create
   contest, and the not-open-yet card;
   (c) C1 and C2 get the tile header, `&event=` and the event page link; the digest links its
   events to their pages;
   (d) link previews.
   Analytics is deferred (Q4) and promotional email is Later (Q5).

## Build notes

- **Slice (a), part 1 (#1007):** the tables, Championship Weekend's seed and the two public
  reads. Championship Weekend launches alone; the Super Bowl and the calendar's other pages follow
  as small seed-only migrations a few weeks before each event. Its Clutch Card offer names the
  series its editions are loaded as, `Conference Championships`. The API takes the sport as its
  enum value (`AMERICAN_FOOTBALL`); the web maps the URL's path segment to it. `bracket_start_round`
  overrides the template's own starting round (the second-chance template starts at round 2; the
  page's bracket at 3). An offer's state comes from `contestOpening`, which asks Create contest's
  own checks as a question: past the cutoff leaves the offer out, and the next edition is tried.
- **Slice (a), part 2:** the `/play/<sport>/<slug>` page and the Coming up rows on How to Play
  (the chosen sport's pages, or the next three) and on the welcome page's no-leagues state; a
  member with leagues lands on their league, so never sees that row. The page's words live in the
  web app (`event-page-copy.ts`), keyed by sport and slug, falling back to the sport blurb and the
  template's name for a page with no copy yet. Until #1008, Start goes to sign-up, or to the
  member's leagues. The upcoming Championship Weekend on QA is the existing date-shifted
  Championship Weekend test seed: loading it shows the Clutch Card OPEN. The NFL bracket and
  squares stay hidden there, because the NFL Playoffs test seed is last season as played, its
  games over; a test seed must carry results, so there is no upcoming-season one.

## Later

- The "News from Poolmaster" category, its sign-up form line and the sync to the email tool
  (Q5), once production is live.
- A "Run your own pool" link on invite and join pages. This puts Poolmaster's own promotion on a
  league's page, which members see as their league's space, so it needs Derek's yes before it is
  built; it never links to or names another league.
- A root admin page to edit event pages, if seeding them by migration becomes a chore.
- Analytics (Q4): a tool, its goals, and the privacy page naming it.
- Storing first-touch UTM tags on the user.

## Out of scope

- Running campaigns, buying ads, audience lists, A/B tests, promotional blasts: the outside
  tools.
- Paid ads before production exists. Prod is not deployed (`plans/production-environment.md`).
- Anything that crosses leagues: no league sees another's contests, members or results.
- Referral rewards or credits.
