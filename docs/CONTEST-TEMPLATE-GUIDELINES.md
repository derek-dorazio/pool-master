# Contest Template Guidelines

What we have learned so far about which contest templates a sport league should offer. These
are **guidelines and recommendations, not rules**. We are still learning which contest types
people use. Use them as the starting point when setting up a new sport or sport league, or when
reviewing a league's templates. Depart from them when the league gives a reason, and say why in
the PR. When one of these turns out wrong, change it here.

The templates themselves are rows seeded by migration, and the code is the source of truth for
what each league offers today. This page holds no per-league counts, so it does not go stale
when templates change. How a template is named, described and checked is a rule:
`rules/ux-rules.md` §12 *League Pages and Commissioner Tools* (item 12).

They come from the owner's league-by-league template review of November 2026.

## General

- **Keep to the common formats.** Offer the formats people already know for the sport, and
  only the variations that change how it plays. A league few people will use gets fewer
  templates, not every format.
- **Men's and women's leagues get the same templates**, unless there is a real difference (fewer
  playoff rounds, a smaller field).
- **No template for a field that does not exist yet.** For example, no upset-bonus template where
  the field has no seeds. Add it when the feed starts giving seeds.
- **A contest stays inside one competition.** A tournament's group matchdays can be its own
  slots, so that a matchday pick'em covers them while brackets stay on the knockout.
- **Introduce a new contest type in one sport first** and see how it is taken up before adding
  it everywhere.

## Tiered and budget

- **Every tiered template has a budget twin** on the same slots, picks and counting rule. The
  exceptions are the player and margin cards below.
- **Playoffs of 12 or more teams only.** With fewer teams the tiers are too thin to give a real
  choice. Leagues with an 8-team playoff (WNBA, NWSL) or a 4-team one (PWHL) get none.
- **Team playoffs: three tiers, one pick each, all count.** For example, tier 1 is the #1 seeds,
  tier 2 seeds 2 to 4, tier 3 the rest. Fit the tier ranges to the league's real seed numbering
  (the NHL seeds 1 to 4 within each division).
- **Individual fields (golf, tennis): two templates.** One with one pick per tier where every
  pick counts, and one where only the best 4 count.
- **Racing:** one tiered and one budget, every pick counts.
- **Tier and price source:** use seeds where the field has them, the odds where it does not, and
  a ranking as the fallback (college football). A profile can list its sources in order.

## Random draw (shown as "Sweepstakes")

- **Team knockouts and tennis: three templates.** *Straight up* (one point per win),
  *Escalating* (points double each round) and *Full* (escalating plus an upset bonus by seed
  difference).
  - Where the field has seeds, Full is the default.
  - Where it has none (World Cup, Euro, Copa América), offer only Straight up and Escalating,
    with Escalating as the default.
- **A bye counts as a win.** A series win counts as one win.
- Golf and finish-position random draws keep their own scoring.
- Call it "Sweepstakes" on screen in every sport. It is the classic office pool.

## Brackets

- **Brackets follow the random draw:** Straight up, Escalating and Full where the field has
  seeds (Full the default), and Straight up and Escalating where it has none (Escalating the
  default).
- **Any single-elimination event can have a bracket**, including conference tournaments.
- **No second-chance brackets.** A bracket starting at a later round (the Sweet 16) is a
  possible future idea.

## Pick'em and survivor

- **Regular seasons get pick'em and survivor across the weeks**: straight up, against the
  spread, and confidence. A league with draws allows draw picks.
- **College football:** limit the weekly pick'em to ranked games, any game with a team ranked
  25 or better, which the commissioner can change.
- **Survivor on a playoff:** one pick per round. Tennis gets no survivor. A bracket is the
  better format there.

## Squares

- **Squares only on single games with period scores** that people gather to watch: football
  games and the March Madness final.
- **None on series** (NBA, NHL, MLB), **on soccer or hockey**, or **on regular-season games**.

## Clutch Card (players scored by their stats)

- **Playoffs only.** No regular-season cards for now.
- **Single-game knockouts** (NFL, CFP, March Madness): a card on the whole playoff, one on the
  final four, and one on the final. **A one-off postseason game** (a bowl game) gets its own card.
- **Series knockouts** (NBA, NHL, MLB, WNBA): a card on the semifinals (the conference finals)
  and one on the finals. **A two-round playoff:** the final only.
- **Single-match tournaments** (soccer cups): a card on the semifinals and one on the final.
- **Tiered only, never budget.** A salary-cap lineup of players is daily fantasy, which this
  product stays clear of in format and in wording (no "fantasy" or "DFS").
- **Team sports only, and only where the feed has per-game player stats.** None for individual
  sports (golf, tennis, racing, cycling, running, combat sports).
- **None for conference tournaments** at first. The biggest conferences may get one later.
- **For a new sport, check where Clutch Card stands, and ask the owner before choosing its
  cards.**

## Margin Card (teams scored by their point margin)

- **Football first, to see if it is taken up:** a card per regular-season week and per playoff
  round, for the NFL and college football.
- **Not over a slate that spans several weeks** (bowl games).
- **Tiered only.** Tiers come from the point spread, because a margin depends on the matchup,
  not only on the team. College football falls back to the ranking when a game has no spread.
- **Plain point differential.** The tiers already charge for picking the favorite.
