# Golf seed data: sources and caveats

Compiled 2026-10-06. Seed data for a mock provider. It is not authoritative.

Data was compiled from web search summaries of the sources listed below, not from the
pages themselves. Verify any value before relying on it.

## How the files fit together

The committed files here are `<tour>-players.json` (one ranked player list per tour) and
`<tour>-<season>.json` (one event slate per tour and season). Event ids
(`<tour>-<season>-<name>`) are the linking ids PoolMaster stores; keep them stable when
editing. Two seasons are partly derived, because 2027 is not fully published:

- **PGA TOUR 2027:** the announced events, plus the 2026 FedExCup Fall events moved to the
  same week of 2027.
- **LPGA Tour 2027:** the 2026 slate moved to the same week of 2027, with the events already
  announced for 2027 replacing their 2026 counterpart or added. The Hong Kong event is left
  out until its dates are known.

Each derived event says so in its `notes`. Every tour's field is its whole player list.

## Coverage

- PGA TOUR 2026: 45 events (37 January–August, including 4 opposite-field, plus 8 FedExCup Fall).
- LPGA Tour 2026: 31 official events.
- PGA TOUR 2027: 34 of the reported 36 announced events, plus the derived Fall events.
- LPGA Tour 2027: 8 confirmed events; the rest derived from 2026.
- Players: PGA TOUR 160 (OWGR ranks 1–50 from search, 51+ estimated); LPGA 149 (Rolex ranks
  1–33 as of 2026-09-28 from search, 34+ estimated).

## Sources referenced via search results

- Wikipedia season articles: https://en.wikipedia.org/wiki/2026_PGA_Tour , https://en.wikipedia.org/wiki/2026_LPGA_Tour , https://en.wikipedia.org/wiki/2027_PGA_Tour
- PGA TOUR 2026 schedule release: https://www.pgatour.com/article/news/latest/2025/08/19/2026-pga-tour-schedule-events-tournaments-players-championship-20th-year-fedexcup-championship-dates-venues-signature-majors
- PGA TOUR 2026 FedExCup Fall: https://www.pgatour.com/article/news/latest/2026/01/09/pga-tour-unveils-2026-fedexcup-fall-schedule-two-new-events-asheville-austin ; https://www.cbssports.com/golf/news/pga-tour-fedex-cup-fall-schedule-2026/
- The Sentry 2026 cancellation: https://www.pgatour.com/article/news/latest/2025/09/16/pga-tour-announces-the-sentry-will-not-be-contested-at-kapalua-in-2026
- Golf Monthly / NBC Sports / golf365 2026 schedule pages: https://www.golfmonthly.com/news/full-pga-tour-schedule-2026 , https://www.nbcsports.com/golf/pga-tour/2026-pga-tour-schedule
- 2026 purses (Sony, AmEx, Farmers, Pebble): https://golf.com/news/2026-sony-open-purse-payout-money/ , https://www.si.com/golf/2026-pga-tour-schedule-complete-dates-winners-purses
- PGA TOUR 2027 schedule (announced 2026-08-26): https://www.pgatour.com/article/news/latest/2026/08/26/pga-tour-announces-2027-schedule-through-tour-championship ; https://www.golfchannel.com/pga-tour/news/pga-tour-2027-schedule-36-events-two-at-pebble-more-signature-spacing ; https://www.cbssports.com/golf/news/pga-tour-2027-schedule/
- GO by Raymond James (Wyndham rename): https://myfox8.com/sports/wyndham-championship/pga-tours-wyndham-championship-in-greensboro-to-become-go-by-raymond-james-under-new-title-sponsor/
- LPGA 2026: https://golf.com/news/lpga-2026-schedule-record-purses-major-stops/ ; https://www.skysports.com/golf/news/13472836/lpga-tour-2026-schedule-tournaments-dates-venues-womens-golf-majors-solheim-cup-and-more ; https://www.lpga.com/news/2026/lauren-coughlin-collects-third-lpga-tour-title-at-aramco-championship ; https://www.golfchannel.com/lpga/2026/lotte-championship-presented-by-hoakalei
- LPGA 2027 pieces: https://justwomenssports.com/reads/lpga-tour-schedule-2027-hong-kong/ ; https://www.golfchannel.com/lpga/news/corning-classic-2027-lpga-schedule-return-5-million-dollar-purse ; https://www.westhawaiitoday.com/2026/07/23/sports/another-lpga-tourney-coming-with-nanea-cup-on-hawaii-island-in-2027/ ; https://www.golfdigest.com/story/lpga-let-golf-saudi-co-sanction-london-championship-2027 ; https://www.lpga.com/news/2026/dow-championship-announces-tournament-dates-for-2027 ; https://www.golfcompendium.com/2025/06/2027-us-womens-open.html
- OWGR: https://golftoday.co.uk/official-world-golf-ranking-40-2026/ (week 40, dated 2026-10-04); ESPN/golfrankingstats top-50 summary
- Rolex: https://golftoday.co.uk/rolex-womens-world-golf-rankings-40-2026/ (2026-09-28)

## Gaps and uncertainties

### PGA 2026
- Purses are `null` for most full-field events and majors other than the Masters; only values seen in search results are filled in. The WM Phoenix Open purse of $9.2M is from one search summary and is unverified. TOUR Championship purse is null (format and purse changed).
- The Schwab (May 28–31), Wyndham (Aug 6–9) and BMW (Aug 20–23) dates were inferred from tournament-week ranges ("May 25–31", "Aug 5–9", "Aug 18–23"), assuming Thursday–Sunday play.
- Some venue detail (sub-course names, the city of Arden for the Biltmore event, Bermuda's Port Royal) comes from knowledge of prior years.
- The Presidents Cup is excluded because it carries no official money.
- Patrick Reed is kept in the players list despite his LIV history; his 2026 tour status is uncertain.

### LPGA 2026
- The Aramco Championship (Apr 2–5, Shadow Creek) seems to replace the T-Mobile Match Play, which one older summary listed for Apr 2–6. Its purse is unknown.
- The BMW Ladies Championship venue is unknown. The Buick Shanghai, Maybank and TOTO venues are assumed from prior years.
- The AIG Women's Open purse is reported as both $9.75M and $10M.
- The Solheim Cup and Grant Thornton Invitational are excluded as unofficial.

### PGA 2027
- 2 of the reported 36 events were not identified. One is possibly the Farmers Insurance Open, since The Sentry moves to Torrey Pines North.
- The BMW Championship venue is unknown.
- The Sentry end date is uncertain: one summary said Jan 28–30.
- The Fall 2027 schedule has not been announced.

### LPGA 2027
- The full schedule was not found as released. Reports said it was expected in the first week of October 2026, so re-check soon.
- The Hong Kong event's dates are unknown (March 2027).
- The Championship (UK) is reported as the week of July 19–25. Thursday–Sunday play (Jul 22–25) is assumed.

### Players
- Only the top ~50 (OWGR) and top ~33 (Rolex) come from ranking lists in search results. All entries marked `rankingEstimated: true` have order estimated from background knowledge. Their numbers are sequential placeholders, not real ranks.
- Some estimated players may not be 2026 tour members, and current Korn Ferry graduates may be missing.
- The OWGR top-50 snapshot may be one week older than the week-40 movement notes. For example, the week-40 notes put Fleetwood at #7, while the list has him at #6.
- LIV players and non-LPGA members were removed, so the `ranking` numbers have gaps.
- ISO codes: England, Scotland and Northern Ireland are mapped to GB.
- "Aki Iwai" in the search text was taken to be Akie Iwai.
- One snippet gave "Nelly Kord"; this is assumed to be Nelly Korda.
