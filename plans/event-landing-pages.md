# Event landing pages and ad tiles

**Tracking issue:** #998

Written 2026-10-24 for Derek's review. Design only: nothing here is built yet. Mockups (a canvas
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

1. **Event pages**, public, one per event series: `/play/nfl/championship-weekend`.
2. **The hooks** that make a click count: links that carry the chosen event and contest setup
   into sign-up, league creation and contest setup, plus tracking tags that survive the trip.
3. **A tile template**: one fixed layout per event for emails, How to Play and ads.

Campaigns, ad buying, audiences, A/B tests and promotional email blasts are run in outside tools
(*Marketing primer* says which kind). Poolmaster's existing commissioner event emails (#845 C1
to C3) are the one exception, because they already exist and already go to the right people.

## Marketing primer

The ideas that matter for this, in plain words, each with what Poolmaster does now and later.

| Idea | What it means | Now | Later |
|---|---|---|---|
| **Funnel** | The steps from seeing an ad to being a happy user: see → click → land → start → sign up → league → contest → invites → entries. Each step loses people; you fix the leakiest step first. | Design every page so the next step is one obvious button. | Measure each step (*Conversion tracking*). |
| **Landing page** | The page an ad click arrives on. It does one job: get one action. It repeats the ad's promise in its headline, so the visitor knows they are in the right place. | The event pages. One main button, no menus to wander into. | Variants per audience if numbers say so. |
| **CTA** (call to action) | The button. One per screen, verb first, says what happens: "Start a free league", "Set up Clutch Card". | Used throughout the mockups. | — |
| **Message match** | The ad, the page headline and the first screen after the click use the same words and picture. A mismatch is the most common reason people bounce. | Tile and page share the event name, hook line and contest types. | — |
| **Seasonality** | Sports demand spikes before big events. Ads start 2 to 3 weeks before; emails go 10 and 7 days before (C1, C2) and 3 days before (C3). | *Event calendar* below. | Put the calendar in the marketing tool. |
| **UTM tags** | Labels added to a link so you know where a click came from: `?utm_source=instagram&utm_medium=paid&utm_campaign=championship-weekend-2027&utm_content=square-a`. Every analytics tool reads them. | Event pages keep them through sign-up (Q4). | — |
| **Conversion tracking** | Counting how many visitors reach each funnel step, split by UTM tag. Tells you which ad paid off. | A privacy-friendly analytics script, no cookies, counting page views and five goal events (Q4). | Store the first UTM on the user if we need it in reports. |
| **Pixels and consent** | Ad networks (Meta for Instagram) offer a "pixel" script that reports conversions back to them, so their ads target better. It sets cookies, which in places like the EU needs a consent banner. | No pixel (Q4). | Add Meta's pixel plus a consent banner when paid ads spend enough to need it. |
| **Email consent** | US law (CAN-SPAM) allows promotional email to people who signed up for a service, as long as it is honest and has a working unsubscribe. EU and Canada need opt-in. Event reminders to commissioners are a feature; "start your own league" to members is promotion. | Commissioner event emails stay as they are. | A "News from Poolmaster" category, sent from the marketing tool (Q5). |
| **Referral loop** | Every user who invites friends is free advertising. For pools this is the biggest channel: one commissioner brings 10 to 50 people, and some of them run their own pool next year. | Invite and join pages link to the event page with "Run your own pool". | A "Start your own league" line in member emails (Q5). |
| **SEO** | Getting found on Google for "office pool for championship weekend". Needs pages Google can read, with a title and description per event. | Event pages are public and get their own title and description. | Prerendered pages if Google won't index them well. |
| **Link previews** | When a page link is pasted into iMessage, WhatsApp, Slack or Instagram, the app fetches the page's "Open Graph" tags to draw a card. Without them a shared link looks broken. This matters more than SEO for pools, which spread by group chat. | Q6. | — |
| **A/B test** | Show two versions to different visitors and keep the winner. Only worth it with a few hundred visits a week. | Keep headline and hook copy in one place per event so a variant is cheap. | Run in the marketing or analytics tool. |
| **Activation** | The moment a user gets value: here, a contest on the event with at least two squads entered. A sign-up that never gets there is not a win. | Count it as the last goal (Q4). | Nudge emails for leagues that stall. |

## Event pages

### Route and data

- `/play/:sportLeagueSlug/:seriesSlug`, outside the sign-in guard like How to Play and `/plans`.
  The slugs are the same lower-case, dash-joined names How to Play already uses for its
  `?league=` links; the series slug comes from `EventSeries.name`. No new column, since a
  series is never renamed.
- **Evergreen**: the URL names the series, not the year, so an ad, an email or a Google result
  keeps working every year. The page shows the series' next edition: the one in progress, else
  the soonest upcoming. After the last one, it says when the next is expected and lists
  what else is coming up in that sports league.
- **Public read** `GET /event-pages/:sportLeagueSlug/:seriesSlug`: the sport, the sport league,
  the series, its next edition (name, dates, status, whether contests can be created on it yet),
  and the default contest setups offered on that edition (template id, selection type, name,
  description), in the order the league's contest types page shows them. And
  `GET /event-pages?sportLeague=` for the upcoming series of one sports league, which feeds How
  to Play's new row and the "Next up" strip. Both are public like `GET /sport-leagues`, and
  carry no league or user data (`rules/architecture-rules.md` §2 *Contract-First API
  Architecture*).
- **Copy lives in the web app**, as all product copy does: a
  small registry keyed by series slug holding the hook line ("Four teams, two games, one
  Sunday"), the eyebrow and an ad-safe short name, like `sport-blurbs.ts`. A series with no
  entry gets a page built from its sport blurb and contest types, so every series has a page on
  day one and the big ones get hand-written copy (Q1).

### Page, top to bottom (boards 1 and 2)

1. Header as `/plans`: How to Play, Plans, Sign in, Start free.
2. Breadcrumb back to How to Play at that sport league.
3. Hero: eyebrow, event name, hook line, date and "Picks close at the first kickoff" from the
   contest rules, the main button and the gift pill ("Every new league gets Premium free for a
   6-month preview period", length from config).
4. **Ways to play**: one card per default contest setup on the edition. Each card names the
   contest type, the setup it starts as ("Championship Weekend Stars"), one plain line on how
   it plays, two facts, and its own button. A new contest type gets a "New" badge.
5. **Ready before kickoff**: three steps, the same as How to Play's.
6. **Next up in this sports league**: the following series, linked.
7. Footer: "Not affiliated with the NFL or any sports league."

On a phone a slim bar with the main button stays at the bottom of the screen once the hero has
scrolled away.

### How to Play zooms in (board 4)

How to Play with a sport league chosen gains a **Coming up** row above its ways to play: one
card per upcoming series in that league, with when, the contest types, and a link to its event
page. With no league chosen, the row shows the next three events across all sports.

## The two audiences

Every button on the page goes to one signed-in route, `/start?event=<id>&template=<id>`, which
decides where the visitor belongs. A signed-out visitor goes through sign-up first (today's
`from` return path), so the route is the same for everyone (board 5).

| Who | What happens |
|---|---|
| Signed out, new | Sign-up form with a banner, "You're starting a Championship Weekend pool". Then Create league (today's form, with "Next: your Clutch Card for Championship Weekend"). Then Create contest prefilled. Then Invites. |
| Signed out, has an account | "Sign in" on the sign-up screen, then as a signed-in visitor. |
| Signed in, runs no league | Create league, then as above. |
| Signed in, runs one league | Create contest in that league, prefilled. |
| Signed in, runs several | The league picker (board 3), then Create contest in the chosen league. |
| Signed in, only a member | The picker shows none of their leagues; it offers "Start a new league" and "Share this page with your commissioner" (Q3). |

- **Leagues are tenants.** The picker lists only leagues the visitor runs, and every path ends
  in that league's own Create contest page. Nothing is shared between leagues.
- **Prefill, never create.** Create contest already takes `?template=`; it gains `?event=` to
  start on that edition. The contest exists only when the commissioner presses Create contest,
  so someone who leaves halfway leaves nothing behind.
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
  (Canva or similar) from it. A root-admin preview page that draws the tile for a series is
  possible later if making them by hand gets old.
- **Copy rules for every ad**: no "fantasy", "bet", "odds", "props", "win cash" or "prizes";
  no league or team logos, team names or player names and photos; "Not affiliated with any
  sports league" on the creative. Meta reviews ads for gambling, and those words get an ad held
  or rejected.
- **Trademarks**: paid ads use generic names ("the big game", "bracket season",
  "Championship Weekend"); our own pages use real event names, as the app already does (Q2).
- **Every ad link** is the event page plus UTM tags. A naming convention keeps reports
  readable: `utm_campaign=<series-slug>-<year>`, `utm_source` the place (instagram, email),
  `utm_medium` paid, email or social, `utm_content` the creative.

## Email (board 8)

Derek's example, "create your Redzone contest today", is the commissioner event email C2 that
#845 already sends to every commissioner, per league, with an unsubscribe. So the commissioner
"blast" needs no outside tool: C1 to C3 adopt the tile as their header, name the default setups
as cards, and link each card straight to Create contest in **that** league with
`?template=&event=`, plus a "See every way to play" link to the event page. Promotion to people
who don't run a league (members, lapsed users) is a different kind of email and waits for the
marketing tool and the consent decision (Q5).

## Event calendar

The events worth a page with hand-written copy and a campaign, in order from now. Ads start 2
to 3 weeks before; C1 to C3 go 10, 7 and 3 days before.

| When | Event page | Main contest types |
|---|---|---|
| Late Jan | NFL Championship Weekend | Clutch Card, Pick'em, Squares |
| Early Feb | Super Bowl | Squares, Clutch Card, Pick'em |
| Mid Mar | Men's and women's college basketball tournaments | Bracket, Pick'em |
| Apr | The Masters | Golf tiers and budget |
| May | Kentucky Derby, Indianapolis 500 | Racing pools |
| Jun | NBA Finals, Stanley Cup Final | Clutch Card, series pick'em |
| Jun–Jul | Wimbledon, Tour de France | Bracket, racing |
| Sep | NFL season kickoff | Survivor, Pick'em for the season |
| Oct | World Series | Clutch Card |

## Questions for Derek

Each has a recommendation; a one-word answer per number is enough.

1. **Which events get a page?** Recommend every event series automatically, with generic copy,
   and hand-written copy only for the calendar's events. Pages exist for anything a
   commissioner might search for, and the copy work stays small.
2. **Event names.** Recommend real names on our own pages (as in the app today) and generic
   names in paid ads ("the big game", "Championship Weekend", not "AFC/NFC"); no logos, teams or
   players anywhere. A short check with a trademark lawyer before the first paid ad is cheap
   insurance.
3. **A member who runs no league** clicks the button. Recommend offering "Start your own league"
   and "Share with your commissioner" (copies the page link). Both are useful, and neither
   reaches into the other league.
4. **Tracking.** Recommend a cookieless analytics tool (Plausible, Fathom or similar, about
   $10–20 a month) on public pages and the sign-up path, counting page views by UTM tag and five
   goals: start, sign-up, league created, contest created, contest activated. No Meta pixel and
   no consent banner until paid ads spend enough to need Meta's targeting. Storing the first
   UTM tag on the user waits until a report needs it.
5. **Promotional email.** Recommend leaving commissioner event emails (C1 to C3) as the
   commissioner channel, and adding a "News from Poolmaster" email category, on by default for
   new sign-ups with a clear line on the sign-up form and one-click unsubscribe, sent from a
   product-email tool (Loops or Customer.io) once production is live. It fits US law, and
   becomes opt-in if Poolmaster ever targets the EU or Canada.
6. **Link previews.** Recommend building Open Graph tags and one preview image per event page
   before the first ad or email goes out: shared links are Poolmaster's main channel, and a
   single-page app shows no preview without them. The how (prerendered page shells at deploy,
   or a small server route) is decided in the build.
7. **Order of work.** Recommend: (a) event page API and pages, plus How to Play's row; (b)
   `/start`, sign-up banner, picker and `?event=` prefill; (c) C1 to C3 adopt the tile; (d) link
   previews; (e) analytics. All before production, so the first campaign (Championship Weekend,
   late January) can run once production is live.

## Out of scope

- Running campaigns, buying ads, audience lists, A/B tests, promotional blasts: the outside
  tools.
- Paid ads before production exists. Prod is not deployed (`plans/production-environment.md`).
- Anything that crosses leagues: no league sees another's contests, members or results.
- Referral rewards or credits.
