import { PlanFeature, championshipYear } from '@poolmaster/shared/domain';
import { squadHistoryInPlan, squadYearInPlan } from '../../../packages/core-api/src/modules/history/plan-visibility';
import type {
  SquadChampionshipView,
  SquadCupView,
  SquadHistoryView,
  SquadYearView,
} from '../../../packages/core-api/src/modules/history/service';

// A squad page on a lower plan (#948): its championship and cup rows are hidden, not deleted,
// and its earlier years are left out without PAST_YEARS.

const NOW = new Date('2026-06-01T12:00:00.000Z');
const THIS_YEAR = championshipYear(NOW);
const SQUAD = { id: 'squad-1', name: 'Big Dawgs' } as SquadYearView['squad'];
const CHAMPIONSHIP_ROW = { cupName: 'Big Dawgs Cup' } as SquadChampionshipView;
const CUP_ROW = { contestsCounted: 2 } as SquadCupView;

function squadYear(year: number): SquadYearView {
  return { squad: SQUAD, year, championship: CHAMPIONSHIP_ROW, cups: [CUP_ROW] };
}

describe('squadYearInPlan', () => {
  it('keeps the championship and cup rows when the plan has both', () => {
    const view = squadYear(THIS_YEAR);

    expect(squadYearInPlan(view, new Set([PlanFeature.CHAMPIONSHIP, PlanFeature.CUP_STANDINGS]))).toEqual(view);
  });

  it('hides the championship row without CHAMPIONSHIP and the cup rows without CUP_STANDINGS, each on its own', () => {
    expect(squadYearInPlan(squadYear(THIS_YEAR), new Set([PlanFeature.CUP_STANDINGS])))
      .toMatchObject({ championship: null, cups: [CUP_ROW] });
    expect(squadYearInPlan(squadYear(THIS_YEAR), new Set([PlanFeature.CHAMPIONSHIP])))
      .toMatchObject({ championship: CHAMPIONSHIP_ROW, cups: [] });
  });
});

describe('squadHistoryInPlan', () => {
  const history: SquadHistoryView = {
    squad: SQUAD,
    medals: { firsts: 3, seconds: 1, thirds: 0 },
    trophies: [],
    years: [squadYear(THIS_YEAR), squadYear(THIS_YEAR - 1)],
  };

  it('keeps every year with PAST_YEARS', () => {
    const shown = squadHistoryInPlan(history, new Set([PlanFeature.PAST_YEARS, PlanFeature.CHAMPIONSHIP, PlanFeature.CUP_STANDINGS]), NOW);

    expect(shown.years.map((year) => year.year)).toEqual([THIS_YEAR, THIS_YEAR - 1]);
  });

  it('leaves out the earlier years without PAST_YEARS, hides each year\'s rows the plan lacks, and keeps the medals', () => {
    const shown = squadHistoryInPlan(history, new Set([PlanFeature.TROPHY_SHELF]), NOW);

    expect(shown.years).toEqual([{ squad: SQUAD, year: THIS_YEAR, championship: null, cups: [] }]);
    expect(shown.medals).toEqual(history.medals);
  });
});
