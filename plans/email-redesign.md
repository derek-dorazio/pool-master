# Email redesign: event first, one click per contest type

**Tracking issue:** none yet. Every question below was answered 2026-10-26; tickets are written
when the build is scheduled.

Written 2026-10-26 for Derek's review. Design only: nothing here is built. Mockups (a canvas of
nine emails: four commissioner, five member):
https://claude.ai/artifact/MHrrut3UKJrkXJcvQh2BQ7

## What Derek asked

Derek has been receiving the commissioner emails on QA (2026-10-26) and asked whether they can
look better and be more intuitive, closer to how we market contest types:

- The three contest types in "Ready for contests" don't use the How to Play pictures, and one
  Create contest button serves all three. Could each be its own clickable tile?
- The Starts and Field table is the most visual part of the email, and neither is the most
  important thing. The event (the Masters, the Daytona 500) is, with a picture and whatever
  branding we may legally use, and then the contest types. The field is minor; the start date
  is useful but not the headline.
- Look at every template, not only "Coming soon" and "Ready for contests".

Time zones are a separate thread ("Show times in user's time zone"). Derek decided there
(2026-10-26) that emails sent days ahead show only the date, and only the 3-hours-before reminder
shows a time, in the reader's zone (ET by default). The mockups follow that. That thread owns the
date and time formatting in `system-email-templates.ts`; this redesign only places its output.

## What changes, in every email

1. **A slim brand bar**: the wordmark on the left, the league's name on the right. It replaces
   today's tall navy header with its tagline, so the email's own subject is what the reader
   sees first.
2. **An event header** wherever an email is about one event: a picture, the sport league as an
   eyebrow, the event name as the headline, and one line for when: the date, or a time only in
   the 3-hours-before reminder. This replaces the
   Starts/Field table. The picture is the sport's How to Play scene (Q1).
3. **Contest type tiles** wherever we offer setups: the type's How to Play picture, the type
   name, the setup in a few words, its one-line summary from How to Play, and a link. The whole
   tile is the link, and it opens Create contest in that league with the setup and the event
   filled in, as `buildCreateContestUrl` does today plus `&event=` (Q3).
4. **A contest card** wherever an email is about one contest: its type picture, name and rules
   in a line.
5. **One gold button per email**, for the one thing the email wants done.
6. **Leaderboard rows** with the reader's entries tinted gold and marked "YOU", and a big place
   callout ("3rd") above the table.
7. **Small print moves down**: the field size becomes a grey line under the tiles.

## Email by email

| Email | Header | Body | Button |
|---|---|---|---|
| C2 Ready for contests | Full picture | Tiles for every default setup; last year's winners (new to C2, Q8) | See every way to play |
| C1 Coming up soon | Full picture | Tiles as a preview (Q9); last year's winners | Plan your contest |
| Weekly digest | Brand bar only | Each event a row with a small sport picture | Your league's contests |
| D1 New contest | Full picture | Contest card; "Picks close" band with days left | Make your picks |
| D2 Picks close soon | Picture strip | Big countdown, contest card | Make your picks |
| Contest is live | Full picture, "Live now" | Entries, format, scoring as three small stats | Watch the leaderboard |
| Live standings | Picture strip | Your place callout, top rows, cut and elimination news | Full leaderboard |
| Final results | Trophy band, winner as headline | Your place callout, final top rows | Final leaderboard |
| Entry receipts | Picture strip | Today's picks list, unchanged | View entry |
| Event changed (postponed, moved, cancelled) | Picture strip | Today's sentences | View contest |
| Invites, welcome, member joined, plan and account emails | Brand bar only | Unchanged | Unchanged |

The live email keeps Derek's 2026-10-21 rule: no entries listed, just the event, rules and the
leaderboard link. The reminder's "14 entries so far" is the one new fact a member email needs.

## Pictures and branding

**What we can use freely.** The How to Play illustrations are our own work. Every sport has a
scene and every contest type has a sheet, so every email can have a picture today with no
licence.

**Event names.** Already decided for event pages (Derek 2026-10-24, `plans/event-landing-pages.md`
Q2): real event names on our own pages, generic names in paid ads. Emails are our own channel to
our own users, so they use real names, as they do today. Naming an event to say what a contest
is about is the textbook case for nominative use.

**What we should not use**, in emails or anywhere: league, event or team logos; event slogans
(Augusta National has registered "A Tradition Unlike Any Other", and "Amen Corner" is theirs
too); photos of a named venue or of recognisable players; anything that suggests an official
tie. Augusta National in particular enforces its marks hard.

**Photos.** A licensed stock photo (Unsplash or a paid library) covers copyright only. It does
not clear logos, signage or recognisable people in the frame, and a ticketed venue may restrict
commercial use. So photos are possible, but only generic scenes (a fairway, an oval at speed, a
floodlit pitch) chosen once per sport, never per event. Q1 asks whether that is worth doing.

**Disclaimer.** Every email whose content names an event says "Not affiliated with {league} or
any sports league." in the footer, the same wording as the event pages.

A trademark lawyer's look before production is already on the list from the event pages design;
these emails should be part of that review.

## How it is built

- **Pictures must be PNG files.** Gmail and Outlook do not show SVG, inline or linked. A script
  renders each illustration from `illustrations.tsx` to a PNG at twice its size, and the PNGs are
  checked in under the web app's public folder (`/email/sports/golf.png`,
  `/email/formats/tiered.png`). Emails link to them by absolute URL on the environment's web
  host. A test fails when an illustration changes and its PNG was not re-rendered, so the email
  and How to Play never drift apart.
- **Images-off still reads.** Outlook desktop blocks images until the reader allows them. The
  event name and time sit in the navy band under the picture, not in the picture, and every
  image has empty alt text, so a blocked image leaves a coloured box, not a hole in the message.
- **Tables, not flex.** The real templates stay table-based with inline styles, as today. Tiles
  stack one per row, which reads well on a phone and in Outlook without media queries (Q4).
- **One renderer per piece.** `eventHeader`, `contestTypeTile`, `contestCard` and `placeCallout`
  join `paragraph` and `button` in `system-email-templates.ts`, so every email draws them the same
  way. The existing `standingsTable` is restyled: the reader's rows get the gold tint and "YOU"
  instead of today's bold "(yours)".
- **The plain-text part** keeps its current lines; the tiles become one line each with their link.

## Overlap with the event pages work

#1009 (slice (c) of the event pages) puts the event tile at the top of C1 and C2, adds `&event=`
to their Create contest links and a "See every way to play" link to the event page. This
redesign covers the first two and changes the third only in where it sits. Recommendation:
build this redesign first, and shrink #1009 to "link C1, C2 and the digest to the event page when
the event has one" (Q7).

## Questions for Derek

**Decided (Derek 2026-10-26): every recommendation accepted**, as written below. Q2 leaves the
in-app name open, as it says.

1. **Event pictures.** Recommend our own sport illustrations now (no licence, already drawn),
   and no photos for launch. If you want photos later, one generic licensed photo per sport,
   never a named venue, logo or player.
2. **Brand name in emails.** The code spells it "Prime Time Commissioner" with the tagline
   "Ultimate Office Pool Manager"; marketing uses "Primetime Commissioner". Recommend
   "Primetime Commissioner" in the brand bar and the sender name, and dropping the tagline from
   the header. `BRAND_NAME` feeds every email, not only the bar and sender: the invite and
   welcome preheaders and the password reset subject and body change with it, and their tests
   move too. **Still open:** Derek accepted this for emails, but has not decided whether the
   in-app name changes from Poolmaster (asked in the "Remove agent notes from UI copy" thread).
   If the app keeps "Poolmaster", the invite, welcome and password reset copy would name a
   brand the reader doesn't see when they click through, so settle the app name before the
   build changes `BRAND_NAME`.
3. **What a tile click does.** Recommend it opens Create contest with the setup and event filled
   in, and the commissioner presses Create, as decided for event pages ("prefill, never
   create"). The alternative, creating the contest straight from the email, saves one press but
   makes a contest the commissioner may not have meant to make.
4. **Tile layout.** The mockups show both: three across (Daytona 500) and one per row (the
   Masters). Recommend one per row: same on phone and desktop, room for the setup's line, and
   it handles four or five setups.
5. **Which emails get the big picture.** Recommend the table above: full picture on C1, C2, new
   contest and contest live; a slim strip on reminders, standings, receipts and event changes;
   none on account and membership emails.
6. **"YOU" marking and place callout** on standings and results. Recommend yes; today the
   reader's row is only bold.
7. **#1009.** Recommend this redesign goes first and #1009 shrinks to the event page links.
8. **Last year's winners in C2.** Today only C1 has them. Recommend adding them to C2 too: it
   is the email the commissioner acts on.
9. **C1 tiles before the event opens.** C1 often goes before an event is released, when Create
   contest can't take it yet. Recommend the tiles link to the league's contest types page now,
   and to the event page once event pages exist.

## Order of work

After Derek's answers, three slices:

1. The PNG pipeline, the shared pieces and the brand bar, applied to C1, C2 and the digest.
   `&event=` needs both ends: today Create contest (`create-contest-page.tsx`) reads only
   `?template=` and picks the soonest event, so this slice also makes it read `?event=`, unless
   #1008 (which adds `?event=` for event pages) has landed first.
2. The member contest emails: new contest, reminders, live, standings, results, receipts and
   event changes.
3. The brand bar on the remaining emails.

Each slice updates `npm run email:preview` output so the "Send email previews" workflow shows
the new look.
