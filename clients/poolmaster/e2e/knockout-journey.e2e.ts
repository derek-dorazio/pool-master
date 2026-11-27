import { expect, test, type APIRequestContext, type Page } from '@playwright/test';
import type { MatchPlace } from '@poolmaster/shared/domain';
import {
  adminSignIn,
  logOut,
  readAdminCredentials,
  type AdminCredentials,
} from './helpers/admin-session';
import { correctFieldParticipant } from './helpers/event-field';
import { readCsrfToken, submitAndRead } from './helpers/browser-writes';
import { addTestParticipants } from './helpers/test-participants';
import { removeJourneyRun, type JourneyRun } from './helpers/journey-teardown';
import { createTestEventThroughApi, findSeededSportLeague } from './helpers/test-event';
import { registerFreshUser } from './helpers/user-session';
import { newRunId, e2eName, e2eEmail, e2eUsername, e2eLeagueCode } from './helpers/test-marker';
import { AWAY_SIDE, HOME_SIDE, bracketLoadMatch, teamOn, type BracketReadMatch } from './helpers/match-sides';
import { tierSetSlotUrl } from './helpers/tier-set-slot';

/**
 * #749 — the knockout journey, on the 2025 WNBA playoffs as they were played (series results
 * from `basketball-2025-wnba-playoffs-test.json`, the seeds spread over the league's seed lines): the root admin builds the playoffs on
 * the shared Manage pages (a seeded league, the eight teams, the tournament, its field with seeds, tiers
 * from those seeds, prices), loads the bracket with one pairing still open, completes
 * that pairing on the bracket tab, and releases it (act 1); a new commissioner creates a
 * basketball contest on it scored 1, 2, 4 a round with the seed-difference upset bonus (act 2);
 * a new member joins by link and picks one team from each tier, each shown by its seed (act 3);
 * and the root admin starts the tournament and names each series' winner on the bracket tab,
 * which moves the knockout leaderboard round by round, then completes it, which settles the
 * contest (act 4).
 *
 * The golden journey's shape and its safety rules, for the same reasons (its header has them in
 * full): a serial file sharing module state between acts, run-unique names, assertions only about
 * what this run created, and teardown of every attempt in `afterAll`. Nothing here is tagged
 * `@smoke`: act 4 writes results and settles a contest, which only the local stack should see.
 * The tournament starts a week from the run, so nothing depends on today's date: the bracket's
 * games carry no times.
 */

/** The 2025 WNBA playoff field, by seed: index 0 is the 1 seed. */
const TEAMS: ReadonlyArray<{ name: string; seed: number }> = [
  { name: 'Minnesota Lynx', seed: 1 },
  { name: 'Las Vegas Aces', seed: 2 },
  { name: 'Atlanta Dream', seed: 3 },
  { name: 'Phoenix Mercury', seed: 4 },
  { name: 'New York Liberty', seed: 5 },
  { name: 'Indiana Fever', seed: 6 },
  { name: 'Seattle Storm', seed: 7 },
  { name: 'Golden State Valkyries', seed: 8 },
];

/**
 * The seed each team carries, by its place in the field. Men's March Madness tiers by seed line
 * (1-4, 5-8, 9-12, 13 and up, #2164), so the eight teams are seeded two to a line, keeping their
 * order, and tiers from seeds put two teams in each tier.
 */
const SEED_NUMBER: readonly number[] = [1, 2, 5, 6, 9, 10, 13, 14];
const TIER_OF_SEED: readonly number[] = [1, 1, 2, 2, 3, 3, 4, 4];

/** A match's side by its number: the home team on side 2, the away team on side 1, as a synced game has them. */
type Side = typeof HOME_SIDE | typeof AWAY_SIDE;

/**
 * The bracket as it was played, by seed (null for a side an earlier series fills). The higher
 * seed is at home. Round 1's match 4's away side, the 7 seed, is left open when the bracket loads, so the
 * admin completes it on the bracket tab before release.
 */
const BRACKET: ReadonlyArray<{
  matchNumber: number;
  roundNumber: number;
  home: number | null;
  away: number | null;
  advancesTo: { roundNumber: number; matchNumber: number; sideNumber: Side } | null;
  winner: Side;
}> = [
  { matchNumber: 1, roundNumber: 1, home: 1, away: 8, advancesTo: { roundNumber: 2, matchNumber: 1, sideNumber: HOME_SIDE }, winner: HOME_SIDE },
  { matchNumber: 2, roundNumber: 1, home: 4, away: 5, advancesTo: { roundNumber: 2, matchNumber: 1, sideNumber: AWAY_SIDE }, winner: HOME_SIDE },
  { matchNumber: 3, roundNumber: 1, home: 3, away: 6, advancesTo: { roundNumber: 2, matchNumber: 2, sideNumber: AWAY_SIDE }, winner: AWAY_SIDE },
  { matchNumber: 4, roundNumber: 1, home: 2, away: 7, advancesTo: { roundNumber: 2, matchNumber: 2, sideNumber: HOME_SIDE }, winner: HOME_SIDE },
  { matchNumber: 1, roundNumber: 2, home: null, away: null, advancesTo: { roundNumber: 3, matchNumber: 1, sideNumber: AWAY_SIDE }, winner: AWAY_SIDE },
  { matchNumber: 2, roundNumber: 2, home: null, away: null, advancesTo: { roundNumber: 3, matchNumber: 1, sideNumber: HOME_SIDE }, winner: HOME_SIDE },
  { matchNumber: 1, roundNumber: 3, home: null, away: null, advancesTo: null, winner: HOME_SIDE },
];
const OPEN_PAIRING = { roundNumber: 1, matchNumber: 4, side: AWAY_SIDE as Side, seed: 7 };
const ROUND_COUNT = 3;

/** The commissioner's scoring: a win is 1 in the first round, 2 in the semifinals, 4 in the final. */
const ROUND_VALUES: readonly number[] = [1, 2, 4];

/** The member's pick in each tier, by place in the field: the Aces, the Mercury, the Fever and the Storm. */
const PICKED_SEEDS: readonly number[] = [2, 4, 6, 7];

/**
 * What the picks score, with the upset bonus on the seeds above. After the first round: the Aces
 * 1, the Mercury 1, the Fever 1 + (10 - 5) = 6 for beating the Dream, and the Storm 0, out to the
 * Aces. After the final: the Aces 1 + 2 + 4 = 7 as champions, the Mercury 1 + 2 + (6 - 1) = 8 for
 * beating the Lynx in the semifinals, the Fever still 6. Without the bonus the entry would score
 * 11, so 21 can only come from the commissioner's settings.
 */
const POINTS_AFTER_ROUND_1: Readonly<Record<number, number>> = { 2: 1, 4: 1, 6: 6, 7: 0 };
const POINTS_AFTER_FINAL: Readonly<Record<number, number>> = { 2: 7, 4: 8, 6: 6, 7: 0 };
const EXPECTED_TOTAL_AFTER_ROUND_1 = 8;
const EXPECTED_TOTAL = 21;

type KnockoutJourneyState = {
  run: JourneyRun;
  teamIds?: string[];
  eventId?: string;
  /** Field-entry ids by seed: index 0 is the 1 seed. */
  fieldEntryIds?: string[];
  leagueId?: string;
  contestId?: string;
  joinUrl?: string;
  entryId?: string;
};

test.describe.configure({ mode: 'serial' });
test.use({ actionTimeout: 20_000 });

let admin: AdminCredentials | undefined;
let journey: KnockoutJourneyState | undefined;
const runs: JourneyRun[] = [];

test.afterAll(async ({ playwright }, testInfo) => {
  if (!admin || runs.length === 0) {
    return;
  }
  let api: APIRequestContext | undefined;
  try {
    api = await playwright.request.newContext({ baseURL: testInfo.project.use.baseURL });
    for (const run of runs) {
      try {
        await removeJourneyRun(api, admin, run);
      } catch (error) {
        console.error(`[teardown ${run.runId}] aborted, run data may remain:`, error);
      }
    }
  } catch (error) {
    console.error('[teardown] could not start; every attempt of this worker may remain:', error);
  } finally {
    await api?.dispose();
  }
});

function requireJourney(): Required<KnockoutJourneyState> {
  if (!journey) {
    throw new Error('act 1 did not record this attempt; the later acts have nothing to consume');
  }
  return journey as Required<KnockoutJourneyState>;
}

function teamName(run: JourneyRun, seed: number): string {
  return `${run.playerNamePrefix} ${TEAMS[seed - 1].name}`;
}

test('act 1: the root admin builds the 2025 WNBA playoffs — league, eight teams, the tournament, its seeded field, tiers and prices — loads the bracket, completes its open pairing through the API, and releases it', async ({ page }) => {
  test.setTimeout(180_000);
  const credentials = readAdminCredentials();
  admin = credentials;

  const runId = newRunId();
  const run: JourneyRun = {
    runId,
    sport: 'BASKETBALL',
    tourUrlSegment: 'ncaamb',
    playerNamePrefix: e2eName('Team', runId),
    tournamentName: e2eName('Playoffs', runId),
    commissioner: {
      username: e2eUsername('kc', runId),
      email: e2eEmail('kc', runId),
      firstName: 'E2E',
      lastName: `Knockout Commissioner ${runId}`,
    },
    member: {
      username: e2eUsername('km', runId),
      email: e2eEmail('km', runId),
      firstName: 'E2E',
      lastName: `Knockout Member ${runId}`,
    },
    leagueName: e2eName('Bracket League', runId),
    leagueCode: e2eLeagueCode('K', runId),
    contestName: e2eName('Playoff Picks', runId),
    squadName: e2eName('Bench', runId),
  };
  runs.push(run);
  journey = { run };
  console.log(`[knockout journey ${runId}] tournament="${run.tournamentName}" league=${run.leagueCode}`);

  await test.step('root admin signs in, and Manage opens on Sports', async () => {
    await adminSignIn(page, credentials);
    await page.goto('/manage');
    await page.getByTestId('root-admin-manage-menu-sports').click();
    await expect(page.getByTestId('root-admin-sports-table')).toBeVisible();
  });

  const leagueId = await test.step('find the seeded basketball league on the Sports page', async () => {
    // A league is added by migration, so a journey plays in a seeded one (#2004): one whose
    // knockout games are single games, as the bracket below names one winner a pairing.
    const { id } = await findSeededSportLeague(page, 'BASKETBALL', run.tourUrlSegment);
    await page.goto('/manage/sports');
    await expect(page.getByTestId(`root-admin-sports-row-${id}`)).toBeVisible();
    return id;
  });

  const teamIds = await test.step(`create the ${TEAMS.length} test teams`, async () => {
    // Test participants (#2096): the league's real teams come only from its feed.
    return addTestParticipants(page.request, { 'x-csrf-token': await readCsrfToken(page) }, leagueId, 'TEAM', TEAMS.map((team) => teamName(run, team.seed)));
  });
  journey.teamIds = teamIds;

  const eventId = await test.step(`create the ${ROUND_COUNT}-round tournament on the league, a week out`, async () => {
    const start = addDays(new Date(), 7);
    start.setHours(19, 0, 0, 0);
    // Eight teams start at the quarterfinals: three series, a round in each slot (#2008).
    const created = await createTestEventThroughApi(page.request, { 'x-csrf-token': await readCsrfToken(page) }, {
      sportLeagueId: leagueId,
      slotKind: 'QUARTERFINAL',
      laterSlotKinds: ['SEMIFINAL', 'FINAL'],
      slotLabel: run.tournamentName,
      startsAt: start.toISOString(),
      name: run.tournamentName,
    });
    await page.goto(`/manage/sports/basketball/events/${created.id}/field`);
    await expect(page.getByTestId('root-admin-event-page')).toBeVisible();
    await page.getByTestId('root-admin-event-settings').click();
    await expect(page.getByTestId('root-admin-event-settings-dialog-rounds')).toContainText(String(ROUND_COUNT));
    return created.id;
  });
  journey.eventId = eventId;

  await test.step(`enter the ${TEAMS.length} teams in the field`, async () => {
    await page.goto(`/manage/sports/basketball/events/${eventId}/field`);
    await page.getByTestId('root-admin-event-field-add').click();
    await page.getByTestId('root-admin-event-field-add-search').fill(runId);
    for (const id of teamIds) {
      const candidate = page.getByTestId(`root-admin-event-field-add-candidate-${id}`);
      await candidate.click();
      await expect(candidate).toHaveAttribute('aria-pressed', 'true');
    }
    await submitAndRead(page, 'root-admin-event-field-add-modal-apply', 'POST', `/api/v1/events/${eventId}/participants`);
    await expect(page.getByTestId('root-admin-event-field-add-modal')).toBeHidden();
  });

  const fieldEntryIds = await test.step('set each team\'s seed in its Field dialog', async () => {
    // Read straight from the API, for each team's field-entry id (the golden journey's tiers step
    // has the reason it is not sniffed from the page).
    const fieldResponse = await page.request.get(`/api/v1/events/${eventId}/participants`);
    expect(fieldResponse.ok(), `GET the field answered ${fieldResponse.status()}`).toBe(true);
    const field = (await fieldResponse.json()) as { participants: { id: string; participantId: string }[] };
    const entryIds = teamIds.map((teamId) => {
      const entry = field.participants.find((candidate) => candidate.participantId === teamId);
      if (!entry) {
        throw new Error(`team ${teamId} is not in the field`);
      }
      return entry.id;
    });

    for (const [index, entryId] of entryIds.entries()) {
      await correctFieldParticipant(page, eventId, entryId, { seedNumber: SEED_NUMBER[index] });
    }
    return entryIds;
  });
  journey.fieldEntryIds = fieldEntryIds;

  await test.step('tier the field, which has a seed for every team, two teams a tier, and price it', async () => {
    await page.getByTestId('root-admin-tier-auto-tiers').click();
    await submitAndRead(page, 'root-admin-tier-auto-tiers-confirm', 'POST', `${await tierSetSlotUrl(page.request, eventId)}/tiers/auto-assign`);
    for (const [index, entryId] of fieldEntryIds.entries()) {
      await expect(page.getByTestId(`root-admin-event-field-row-${entryId}`)).toContainText(`Tier ${String(TIER_OF_SEED[index])}`);
    }
    await page.getByTestId('root-admin-tier-auto-prices').click();
    await expect(page.getByTestId('root-admin-tier-auto-prices-preview')).toBeVisible();
    await submitAndRead(page, 'root-admin-tier-auto-prices-confirm', 'POST', `${await tierSetSlotUrl(page.request, eventId)}/prices/auto-assign`);
  });

  await test.step('load the bracket with the 2 seed\'s first-round opponent still open, as a data file would before the play-in is decided', async () => {
    // Manage has no bracket upload: a bracket arrives from a sport data file through the API.
    // The bracket tab is what the admin works with once it is loaded.
    const entryOfSeed = (seed: number | null) => (seed === null ? null : fieldEntryIds[seed - 1]);
    const response = await page.request.put(`/api/v1/events/${eventId}/bracket`, {
      headers: { 'x-csrf-token': await readCsrfToken(page) },
      data: {
        matches: BRACKET.map((match) => {
          const isOpen = match.roundNumber === OPEN_PAIRING.roundNumber && match.matchNumber === OPEN_PAIRING.matchNumber;
          return bracketLoadMatch({
            matchNumber: match.matchNumber,
            roundNumber: match.roundNumber,
            home: isOpen && OPEN_PAIRING.side === HOME_SIDE ? null : entryOfSeed(match.home),
            away: isOpen && OPEN_PAIRING.side === AWAY_SIDE ? null : entryOfSeed(match.away),
            isNeutralSite: false,
            scheduledDate: null,
            advancesTo: match.advancesTo,
          });
        }),
      },
    });
    expect(response.ok(), `PUT the bracket answered ${response.status()} ${await response.text()}`).toBe(true);
  });

  await test.step('the open pairing is completed through the API, as the test-data loader completes one; the bracket then names both teams', async () => {
    // A head-to-head event's results come only from the feed (#2074): the root admin has no
    // bracket editor, so a test event's bracket is written through the API, as the loader does.
    const { roundNumber, matchNumber, side, seed } = OPEN_PAIRING;
    // An edit names both sides: the open one gets its team, the other keeps the one it has.
    const before = await pairingOf(page, eventId, OPEN_PAIRING);
    const other = side === HOME_SIDE ? AWAY_SIDE : HOME_SIDE;
    const response = await page.request.patch(`/api/v1/events/${eventId}/bracket/rounds/${roundNumber}/matches/${matchNumber}`, {
      headers: { 'x-csrf-token': await readCsrfToken(page) },
      data: {
        sides: [
          { sideNumber: side, sportEventParticipantId: fieldEntryIds[seed - 1] },
          { sideNumber: other, sportEventParticipantId: other === HOME_SIDE ? before.home : before.away },
        ],
      },
    });
    expect(response.ok(), `PATCH round ${roundNumber} match ${matchNumber} answered ${response.status()} ${await response.text()}`).toBe(true);
    expect(await pairingOf(page, eventId, OPEN_PAIRING)).toEqual({ home: fieldEntryIds[1], away: fieldEntryIds[6] });
  });

  await test.step('release the tournament for contests', async () => {
    await page.goto(`/manage/sports/basketball/events/${eventId}`);
    await page.getByTestId('root-admin-event-release-chip').click();
    await page.getByTestId('root-admin-sport-event-release').click();
    const released = await submitAndRead<{ event: { status: string } }>(
      page,
      'root-admin-sport-event-release-confirm',
      'POST',
      `/api/v1/events/${eventId}/release`,
    );
    expect(released.event.status).toBe('SCHEDULED');
  });

  await test.step('root admin logs out', async () => {
    await logOut(page);
  });
});

test('act 2: a new commissioner creates a basketball contest on the playoffs, one team a tier scored 1, 2, 4 with the upset bonus, opens it, and hands out a join link', async ({ page }) => {
  test.setTimeout(120_000);
  const state = requireJourney();
  const { run } = state;

  await test.step('a fresh commissioner registers and creates a league', async () => {
    await page.goto('/');
    await page.getByTestId('auth-mode-register').click();
    await registerFreshUser(page, run.commissioner);
    await page.getByTestId('welcome-create-league').click();
    await page.getByTestId('create-league-code').fill(run.leagueCode);
    await page.getByTestId('create-league-name').fill(run.leagueName);
    const created = await submitAndRead<{ league: { id: string } }>(page, 'create-league-submit', 'POST', '/api/v1/leagues');
    state.leagueId = created.league.id;
    await expect(page.getByTestId('league-home')).toBeVisible();
  });

  await test.step('choose basketball and the playoffs, then set one team a tier, all four counting', async () => {
    await page.goto(`/league/${run.leagueCode}/admin/contests/new`);
    await expect(page.getByTestId('create-contest-page')).toBeVisible();
    await page.getByTestId('contest-sport-BASKETBALL').click();
    const eventChoice = page.getByTestId(`contest-event-${state.eventId}`);
    await expect(eventChoice).toContainText(run.tournamentName);
    await eventChoice.click();
    await expect(eventChoice).toBeChecked();
    // The seeded league's default setup fills the rules once its presets arrive; the commissioner
    // waits for it, then sets every rule by hand on Custom.
    const custom = page.getByTestId('contest-template-custom');
    await expect(custom).toHaveAttribute('aria-checked', 'false');
    await custom.click();
    await expect(custom).toHaveAttribute('aria-checked', 'true');
    await page.getByTestId('contest-tiered-picks-per-tier').fill('1');
    await page.getByTestId('contest-tiered-counted-scores').fill('4');
  });

  await test.step(`score a win ${ROUND_VALUES.join(', ')} by round, add the seed-difference upset bonus, name the contest, and create it`, async () => {
    await page.getByTestId('contest-scoring-round-values').fill(ROUND_VALUES.join(', '));
    await expect(page.getByTestId('contest-scoring-round-values')).toHaveValue(ROUND_VALUES.join(', '));
    await page.getByTestId('contest-scoring-upset-bonus').selectOption('SEED_DIFFERENCE');
    await expect(page.getByTestId('contest-scoring-upset-bonus-multiplier')).toHaveValue('1');
    await page.getByTestId('contest-name').fill(run.contestName);
    const created = await submitAndRead<{ contest: { id: string; sport?: string | null } }>(
      page,
      'create-contest-submit',
      'POST',
      `/api/v1/leagues/${state.leagueId}/contests`,
    );
    expect(created.contest.sport).toBe('BASKETBALL');
    state.contestId = created.contest.id;
    await expect(page.getByTestId('manage-contest-page')).toBeVisible();
  });

  await test.step('open the contest to the league', async () => {
    await page.getByTestId('contest-open-to-league').click();
    const opened = await submitAndRead<{ contest: { status: string } }>(
      page,
      'contest-open-confirm',
      'POST',
      `/api/v1/leagues/${state.leagueId}/contest-management/contests/${state.contestId}/open`,
    );
    expect(opened.contest.status).toBe('OPEN');
  });

  await test.step('generate the join URL', async () => {
    await page.goto(`/league/${run.leagueCode}/admin/invites`);
    const created = await submitAndRead<{ invitation: { inviteCode: string } }>(
      page,
      'league-create-join-url',
      'POST',
      `/api/v1/leagues/${state.leagueId}/invite-link`,
    );
    const joinUrl = page.getByTestId('league-join-url');
    await expect(joinUrl).toHaveValue(new RegExp(`/invite/${created.invitation.inviteCode}$`));
    state.joinUrl = await joinUrl.inputValue();
  });

  await test.step('the commissioner logs out', async () => {
    await logOut(page);
  });
});

test('act 3: a new member joins by the link and submits one team from each tier, each offered by its seed, with no tiebreaker to choose', async ({ page }) => {
  test.setTimeout(120_000);
  const state = requireJourney();
  const { run } = state;

  await test.step('register through the join link and accept', async () => {
    await page.goto(state.joinUrl);
    await page.getByTestId('invite-create-account').click();
    await registerFreshUser(page, run.member);
    await expect(page.getByTestId('join-league-page')).toBeVisible();
    await page.getByTestId('join-league-team-name').fill(run.squadName);
    await page.getByTestId('join-league-team-icon-CAPTAIN_SMILE_OCEAN').click();
    await page.getByTestId('invite-accept').click();
    await expect(page.getByTestId('league-home')).toBeVisible();
  });

  await test.step('create an entry on the contest', async () => {
    await page.goto(`/league/${run.leagueCode}/contests/${state.contestId}`);
    const created = await submitAndRead<{ entry: { id: string } }>(
      page,
      'contest-board-create-entry',
      'POST',
      `/api/v1/contests/${state.contestId}/entries/me`,
    );
    state.entryId = created.entry.id;
    await expect(page.getByTestId('contest-entry-builder-heading')).toBeVisible();
  });

  await test.step(`pick seeds ${PICKED_SEEDS.join(', ')}, one from each tier, and submit`, async () => {
    for (const seed of PICKED_SEEDS) {
      const fieldEntryId = state.fieldEntryIds[seed - 1];
      const choice = page.getByTestId(`contest-entry-participant-${fieldEntryId}`);
      await expect(choice).toContainText(`(${String(SEED_NUMBER[seed - 1])}) ${teamName(run, seed)}`);
      await submitAndRead(page, `contest-entry-participant-${fieldEntryId}`, 'PUT', `/api/v1/selections/${state.contestId}/entries/${state.entryId}/picks/${fieldEntryId}`);
      await expect(page.getByTestId(`contest-entry-selected-${fieldEntryId}`)).toBeVisible();
    }
    await expect(page.getByTestId('contest-entry-tiebreaker-select')).toHaveCount(0);
    await submitAndRead(
      page,
      'contest-entry-submit',
      'POST',
      `/api/v1/selections/${state.contestId}/entries/${state.entryId}/events/${state.eventId}/submit`,
    );
    await expect(page.getByTestId(`contest-board-entry-${state.entryId}`)).toBeVisible();
  });

  await test.step('the member logs out', async () => {
    await logOut(page);
  });
});

test('act 4: the root admin starts the playoffs and names each series\' winner through the API; the knockout leaderboard follows round by round, and completing the tournament settles the contest', async ({ page }) => {
  test.setTimeout(180_000);
  const state = requireJourney();
  const { run } = state;

  await test.step('root admin signs in and starts the tournament', async () => {
    await adminSignIn(page, readAdminCredentials());
    await moveTournamentTo(page, state.eventId, 'IN_PROGRESS');
  });

  await test.step('name the four first-round winners; each moves on to its semifinal', async () => {
    for (const match of BRACKET.filter((candidate) => candidate.roundNumber === 1)) {
      await recordWinner(page, state.eventId, match, match.winner);
    }
    // The semifinals as they were played: the Lynx host the Mercury, the Aces host the Fever.
    expect(await pairingOf(page, state.eventId, { roundNumber: 2, matchNumber: 1 })).toEqual({ home: state.fieldEntryIds[0], away: state.fieldEntryIds[3] });
    expect(await pairingOf(page, state.eventId, { roundNumber: 2, matchNumber: 2 })).toEqual({ home: state.fieldEntryIds[1], away: state.fieldEntryIds[5] });
  });

  await test.step(`after the first round the entry has ${EXPECTED_TOTAL_AFTER_ROUND_1}, the Fever's upset of the 3 seed among it, and the Storm is out`, async () => {
    // The board is rebuilt in a background job a moment after each winner is saved (#1463).
    await expect.poll(async () => (await readKnockoutLeaderboard(page, state.contestId, state.entryId)).total, {
      message: 'the board shows the first round once its rebuild has run',
    }).toBe(EXPECTED_TOTAL_AFTER_ROUND_1);
    const read = await readKnockoutLeaderboard(page, state.contestId, state.entryId);
    expect(pointsBySeed(read, state.fieldEntryIds)).toEqual(POINTS_AFTER_ROUND_1);

    await page.goto(`/league/${run.leagueCode}/contests/${state.contestId}`);
    await expect(page.getByTestId(`contest-leaderboard-total-${state.entryId}`)).toHaveText(String(EXPECTED_TOTAL_AFTER_ROUND_1));
    // The root admin has no entry of their own, so every row starts closed: Show all details opens them.
    await page.getByTestId('contest-leaderboard-toggle-all').click();
    await expect(page.getByTestId(`contest-leaderboard-entry-toggle-${state.entryId}`)).toHaveAttribute('aria-expanded', 'true');
    await expect(page.getByTestId('contest-leaderboard-upset-bonus-header')).toBeVisible();
    const fever = pickOf(read, state.fieldEntryIds, 6);
    const storm = pickOf(read, state.fieldEntryIds, 7);
    await expect(page.getByTestId(`contest-leaderboard-pick-upset-bonus-${state.entryId}-${fever.pickId}`)).toHaveText('+5');
    await expect(page.getByTestId(`contest-leaderboard-pick-status-${state.entryId}-${fever.pickId}`)).toHaveText('In');
    await expect(page.getByTestId(`contest-leaderboard-pick-status-${state.entryId}-${storm.pickId}`)).toHaveText(/^Out · /);
    await expect(page.getByTestId('contest-leaderboard-settled-note')).toHaveCount(0);
  });

  await test.step('name the semifinal and final winners: the Mercury upset the Lynx, and the Aces win it all', async () => {
    for (const match of BRACKET.filter((candidate) => candidate.roundNumber > 1)) {
      await recordWinner(page, state.eventId, match, match.winner);
    }
    expect(await pairingOf(page, state.eventId, { roundNumber: 3, matchNumber: 1 })).toEqual({ home: state.fieldEntryIds[1], away: state.fieldEntryIds[3] });
  });

  await test.step('complete the tournament, which settles the contest', async () => {
    await moveTournamentTo(page, state.eventId, 'COMPLETED');
  });

  await test.step(`the settled entry scores ${EXPECTED_TOTAL} with the upset bonus, the Aces are champions, and the leaderboard says it is final`, async () => {
    // The contest settles in a background job a moment after the event completes (#1448).
    await expect.poll(async () => {
      const managed = await page.request.get(
        `/api/v1/leagues/${state.leagueId}/contest-management/contests/${state.contestId}`,
      );
      expect(managed.ok(), `GET the managed contest answered ${managed.status()}`).toBe(true);
      const { contest } = (await managed.json()) as { contest: { status: string } };
      return contest.status;
    }, { message: 'the contest settles once the event completes' }).toBe('COMPLETED');

    const read = await readKnockoutLeaderboard(page, state.contestId, state.entryId);
    expect(read.total).toBe(EXPECTED_TOTAL);
    expect(read.position).toBe(1);
    expect(pointsBySeed(read, state.fieldEntryIds)).toEqual(POINTS_AFTER_FINAL);

    await page.goto(`/league/${run.leagueCode}/contests/${state.contestId}`);
    await expect(page.getByTestId('contest-leaderboard-settled-note')).toBeVisible();
    await expect(page.getByTestId(`contest-leaderboard-total-${state.entryId}`)).toHaveText(String(EXPECTED_TOTAL));
    // The root admin has no entry of their own, so every row starts closed: Show all details opens them.
    await page.getByTestId('contest-leaderboard-toggle-all').click();
    await expect(page.getByTestId(`contest-leaderboard-entry-toggle-${state.entryId}`)).toHaveAttribute('aria-expanded', 'true');
    const aces = pickOf(read, state.fieldEntryIds, 2);
    const mercury = pickOf(read, state.fieldEntryIds, 4);
    await expect(page.getByTestId(`contest-leaderboard-pick-status-${state.entryId}-${aces.pickId}`)).toHaveText('Champion');
    await expect(page.getByTestId(`contest-leaderboard-pick-wins-${state.entryId}-${aces.pickId}`)).toHaveText('3');
    await expect(page.getByTestId(`contest-leaderboard-pick-status-${state.entryId}-${mercury.pickId}`)).toHaveText(/^Out · /);
  });

  await test.step('root admin logs out', async () => {
    await logOut(page);
  });
});

type KnockoutPickRead = {
  pickId: string;
  sportEventParticipantId: string;
  knockout: { points: number; wins: number; upsetBonusPoints: number; isAlive: boolean } | null;
};

type KnockoutLeaderboardRead = {
  total: number | null;
  position: number | null;
  picks: KnockoutPickRead[];
};

/** The entry's row of the contest leaderboard, as the API serves it to the signed-in user. */
async function readKnockoutLeaderboard(page: Page, contestId: string, entryId: string): Promise<KnockoutLeaderboardRead> {
  const response = await page.request.get(`/api/v1/contests/${contestId}/leaderboard`);
  expect(response.ok(), `GET the leaderboard answered ${response.status()}`).toBe(true);
  const body = (await response.json()) as {
    scoringDefinitionId: string;
    entries: Array<{ entryId: string; position: number | null; totalScore: number | null; picks: KnockoutPickRead[] }>;
  };
  expect(body.scoringDefinitionId).toBe('KNOCKOUT_ROUND_POINTS');
  const entry = body.entries.find((candidate) => candidate.entryId === entryId);
  if (!entry) {
    throw new Error(`entry ${entryId} is not on the leaderboard`);
  }
  return { total: entry.totalScore, position: entry.position, picks: entry.picks };
}

function pickOf(read: KnockoutLeaderboardRead, fieldEntryIds: readonly string[], seed: number): KnockoutPickRead {
  const pick = read.picks.find((candidate) => candidate.sportEventParticipantId === fieldEntryIds[seed - 1]);
  if (!pick) {
    throw new Error(`the entry has no pick of the ${seed} seed`);
  }
  return pick;
}

/** Each pick's knockout points, keyed by its team's seed. */
function pointsBySeed(read: KnockoutLeaderboardRead, fieldEntryIds: readonly string[]): Record<number, number | null> {
  return Object.fromEntries(read.picks.map((pick) => [
    fieldEntryIds.indexOf(pick.sportEventParticipantId) + 1,
    pick.knockout?.points ?? null,
  ]));
}

/**
 * Names one match's winner through the API, as the test-data loader enters a test event's result:
 * a head-to-head event's results come only from the feed, so the root admin has no winner buttons
 * (#2074).
 */
async function recordWinner(page: Page, eventId: string, { roundNumber, matchNumber }: MatchPlace, winner: Side) {
  const response = await page.request.put(`/api/v1/events/${eventId}/bracket/rounds/${roundNumber}/matches/${matchNumber}/result`, {
    headers: { 'x-csrf-token': await readCsrfToken(page) },
    data: { winnerSideNumber: winner, sides: [{ sideNumber: AWAY_SIDE, score: null }, { sideNumber: HOME_SIDE, score: null }] },
  });
  expect(response.ok(), `PUT the result of round ${roundNumber} match ${matchNumber} answered ${response.status()} ${await response.text()}`).toBe(true);
}

/** The field rows on both sides of one match, as the event's bracket read gives them. */
async function pairingOf(page: Page, eventId: string, place: MatchPlace): Promise<{ home: string | null; away: string | null }> {
  const response = await page.request.get(`/api/v1/events/${eventId}/bracket`);
  expect(response.ok(), `GET the bracket answered ${response.status()}`).toBe(true);
  const { matches } = (await response.json()) as { matches: BracketReadMatch[] };
  const match = matches.find((candidate) => candidate.roundNumber === place.roundNumber && candidate.matchNumber === place.matchNumber);
  return { home: teamOn(match, HOME_SIDE), away: teamOn(match, AWAY_SIDE) };
}

async function moveTournamentTo(page: Page, eventId: string, status: 'IN_PROGRESS' | 'COMPLETED') {
  await page.goto(`/manage/sports/basketball/events/${eventId}`);
  await page.getByTestId('root-admin-event-settings').click();
  await page.getByTestId(`root-admin-sport-event-transition-${status}`).click();
  const moved = await submitAndRead<{ event: { status: string } }>(
    page,
    'root-admin-sport-event-transition-confirm',
    'POST',
    `/api/v1/events/${eventId}/transition`,
  );
  expect(moved.event.status).toBe(status);
}

function addDays(date: Date, days: number): Date {
  const next = new Date(date);
  next.setDate(next.getDate() + days);
  return next;
}

