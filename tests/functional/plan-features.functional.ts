import {
  getChampionship,
  getCup,
  getHistorySummary,
  getSquadHistory,
  getSquadYear,
  getYearReview,
  listChampionshipYears,
  listContestResults,
  listCupSeasons,
  listCups,
  listLeagueSquads,
  listPerpetualTrophies,
  listRecords,
  sendYearReview,
  updateLeagueCupSettings,
  updateLeaguePlan,
} from '@poolmaster/shared/generated/hey-api';
import { CupPointsScale, LeaguePlan, PlanFeature, championshipYear } from '@poolmaster/shared/domain';
import { ErrorEnvelopeSchema, SquadYearResponseSchema } from '@poolmaster/shared/dto';
import { buildLeagueWithCommissioner, buildRegisteredUser, promoteToRootAdmin } from './builders';
import { cleanupFunctionalData, disconnectFunctionalPrisma } from './setup';
import { expectDefined } from '../support/expect-defined';

// Hiding features by plan end to end (#948): on Free, every championship, cup and history route
// answers 403 PLAN_FEATURE_NOT_INCLUDED naming the feature it lacks, while contest results stay
// open. Pro opens the championship, cups, trophies and past years but not All years or the
// record book. A root admin is held to the league's plan too. Back on Platinum, everything opens
// again: nothing was deleted.

afterAll(async () => {
  await cleanupFunctionalData();
  await disconnectFunctionalPrisma();
});

const YEAR = championshipYear(new Date());
const UNKNOWN_CUP = '00000000-0000-4000-8000-000000000948';

/** The status of a response, and the feature a 403 names. */
function outcome(result: { response: Response; error?: unknown }) {
  if (result.response.status !== 403) {
    return { status: result.response.status };
  }
  const envelope = ErrorEnvelopeSchema.parse(result.error);
  return { status: 403, code: envelope.error.code, feature: (envelope.error.details as { feature?: string } | undefined)?.feature };
}

function locked(feature: PlanFeature) {
  return { status: 403, code: 'PLAN_FEATURE_NOT_INCLUDED', feature };
}

describe('SDK Functional: features hidden by plan (#948)', () => {
  it('refuses each championship, cup and history view the league\'s plan lacks, keeps contest results open, and opens everything again on Platinum', async () => {
    const { commissioner, league } = await buildLeagueWithCommissioner({ displayName: 'Plan Gatekeeper', leagueName: 'Plan Gates' });
    const client = commissioner.client;
    const path = { id: league.id };
    const squadId = expectDefined(expectDefined((await listLeagueSquads({ client, path })).data).squads[0]).id;
    const moveTo = async (plan: LeaguePlan) => {
      expect((await updateLeaguePlan({ client, path, body: { plan } })).response.status).toBe(200);
    };
    const cupSettings = (hallOfLameVisible: boolean) => updateLeagueCupSettings({
      client,
      path,
      body: { cupName: 'Gate Cup', cupPointsScale: CupPointsScale.STANDARD, cupCustomPoints: [], hallOfLameVisible },
    });
    const views = async (as = client) => ({
      championshipYears: outcome(await listChampionshipYears({ client: as, path })),
      championship: outcome(await getChampionship({ client: as, path: { id: league.id, year: YEAR } })),
      lastYearsChampionship: outcome(await getChampionship({ client: as, path: { id: league.id, year: YEAR - 1 } })),
      cupSeasons: outcome(await listCupSeasons({ client: as, path })),
      cups: outcome(await listCups({ client: as, path, query: { seasonYear: YEAR } })),
      lastYearsCups: outcome(await listCups({ client: as, path, query: { seasonYear: YEAR - 1 } })),
      cup: outcome(await getCup({ client: as, path: { id: league.id, cupId: UNKNOWN_CUP } })),
      trophies: outcome(await listPerpetualTrophies({ client: as, path })),
      squadHistory: outcome(await getSquadHistory({ client: as, path: { id: league.id, squadId } })),
      summary: outcome(await getHistorySummary({ client: as, path })),
      records: outcome(await listRecords({ client: as, path })),
      yearReview: outcome(await getYearReview({ client: as, path })),
      contestResults: outcome(await listContestResults({ client: as, path, query: { year: YEAR } })),
    });

    // --- Free: only contest results ----------------------------------------------------------
    await moveTo(LeaguePlan.FREE);
    expect(await views()).toEqual({
      championshipYears: locked(PlanFeature.CHAMPIONSHIP),
      championship: locked(PlanFeature.CHAMPIONSHIP),
      lastYearsChampionship: locked(PlanFeature.CHAMPIONSHIP),
      cupSeasons: locked(PlanFeature.CUP_STANDINGS),
      cups: locked(PlanFeature.CUP_STANDINGS),
      lastYearsCups: locked(PlanFeature.CUP_STANDINGS),
      cup: locked(PlanFeature.CUP_STANDINGS),
      trophies: locked(PlanFeature.TROPHY_SHELF),
      squadHistory: locked(PlanFeature.TROPHY_SHELF),
      summary: locked(PlanFeature.ALL_TIME_SUMMARY),
      records: locked(PlanFeature.RECORD_BOOK),
      yearReview: locked(PlanFeature.EMAIL_YEAR_IN_REVIEW),
      contestResults: { status: 200 },
    });
    expect(outcome(await sendYearReview({ client, path: { id: league.id, year: YEAR - 1 } }))).toEqual(locked(PlanFeature.EMAIL_YEAR_IN_REVIEW));
    expect(outcome(await cupSettings(true))).toEqual(locked(PlanFeature.CUP_SETTINGS));
    // The squad page keeps its contests; its championship and cup rows are hidden, not refused.
    const freeSquadYear = await getSquadYear({ client, path: { id: league.id, squadId }, query: { year: YEAR } });
    expect(SquadYearResponseSchema.parse(expectDefined(freeSquadYear.data)).squadYear).toMatchObject({ championship: null, cups: [] });
    expect(outcome(await getSquadYear({ client, path: { id: league.id, squadId }, query: { year: YEAR - 1 } })))
      .toEqual(locked(PlanFeature.PAST_YEARS));

    // A root admin outside the league sees what its members see.
    const admin = await buildRegisteredUser({ displayName: 'Plan Gate Admin' });
    await promoteToRootAdmin(admin);
    expect((await views(admin.client)).championship).toEqual(locked(PlanFeature.CHAMPIONSHIP));

    // --- Pro: championships, cups, trophies and past years; not All years or the record book --
    await moveTo(LeaguePlan.PRO);
    expect(await views()).toEqual({
      championshipYears: { status: 200 },
      championship: { status: 200 },
      lastYearsChampionship: { status: 200 },
      cupSeasons: { status: 200 },
      cups: { status: 200 },
      lastYearsCups: { status: 200 },
      cup: { status: 404 },
      trophies: { status: 200 },
      squadHistory: { status: 200 },
      summary: locked(PlanFeature.ALL_TIME_SUMMARY),
      records: locked(PlanFeature.RECORD_BOOK),
      yearReview: { status: 200 },
      contestResults: { status: 200 },
    });
    // Championship settings save, but the Hall of Lame switch belongs to the record book.
    expect(outcome(await cupSettings(true))).toEqual({ status: 200 });
    expect(outcome(await cupSettings(false))).toEqual(locked(PlanFeature.RECORD_BOOK));

    // --- Platinum: everything again ------------------------------------------------------------
    await moveTo(LeaguePlan.PLATINUM);
    const platinum = await views();
    expect(Object.values(platinum).filter((view) => view.status === 403)).toEqual([]);
    expect(outcome(await cupSettings(false))).toEqual({ status: 200 });
  });
});
