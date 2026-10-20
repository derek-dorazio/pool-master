import type { ContestConfigTemplateListResponse, SelectionStateResponse } from '@poolmaster/shared/generated/hey-api';
import { ContestFormat, ContestTemplateEventType, SelectionType, Sport } from '@poolmaster/shared/domain';
import { formatLoadReport, LoadAction, LoadMode, LoadSubject } from '../../../packages/core-api/scripts/seed-golf/load-report';
import type { SportDataFile } from '../../../packages/core-api/scripts/seed-golf/sport-data-file';
import { chooseContestTemplate, choosePicks, refuseUnlessTestTarget, testLeagueCode, testLeagueName } from '../../../packages/core-api/scripts/seed-golf/test-participants-data';

type Template = ContestConfigTemplateListResponse['templates'][number];
type Group = NonNullable<SelectionStateResponse['selectionGroups']>[number];

function row(id: string, price: number, extra: Partial<Group['participants'][number]> = {}): Group['participants'][number] {
  return { sportEventParticipantId: id, participantId: `p-${id}`, participantName: id, seedNumber: null, isAvailable: true, price, ...extra };
}

function state(selectionType: SelectionStateResponse['selectionType'], groups: Group[], lineupSummary: SelectionStateResponse['lineupSummary'] = null): SelectionStateResponse {
  return {
    contestId: 'c', contestName: 'Contest', sportEventId: 'e', acceptsPicks: true, selectionType, drawnAt: null, rosterSize: 0, status: 'PENDING', myEntryId: null,
    entries: [], pickHistories: [], availableParticipantIds: [], selectionGroups: groups, isComplete: false, lineupSummary,
  };
}

function group(groupNumber: number, picksFromGroup: number, participants: Group['participants']): Group {
  return { groupId: `g${groupNumber}`, groupName: `Tier ${groupNumber}`, groupNumber, picksFromGroup, selectedParticipantIds: [], participants };
}

describe('test participants: picking a lineup', () => {
  it('fills each tier with its missing picks, skipping unavailable rows and the ones already picked', () => {
    const tiered = state(SelectionType.TIERED, [
      group(1, 2, [row('a', 0, { isSelected: true }), row('b', 0, { isAvailable: false }), row('c', 0), row('d', 0)]),
      group(2, 1, [row('e', 0), row('f', 0)]),
    ]);

    expect(choosePicks(tiered, 0)).toEqual(['c', 'e']);
  });

  it('gives each player a different lineup by starting each tier at a different row', () => {
    const tiered = state(SelectionType.TIERED, [group(1, 1, [row('a', 0), row('b', 0), row('c', 0)])]);

    expect([0, 1, 2, 3].map((index) => choosePicks(tiered, index))).toEqual([['a'], ['b'], ['c'], ['a']]);
  });

  it('fills a budget lineup from a varied window of the cheapest, and falls back to the cheapest when the window costs more than is left', () => {
    const field = group(1, 2, [row('w', 400), row('x', 100), row('y', 200), row('z', 300), row('v', 500), row('u', 600)]);
    const summary = (remaining: number) => ({ selectionType: SelectionType.BUDGET_PICK, salaryCap: 1000, spent: 1000 - remaining, remaining, isOverBudget: false, openSlots: 2, cheapestFill: 300 });

    expect(choosePicks(state(SelectionType.BUDGET_PICK, [field], summary(1000)), 1)).toEqual(['z', 'w']);
    expect(choosePicks(state(SelectionType.BUDGET_PICK, [field], summary(500)), 1)).toEqual(['x', 'y']);
  });

  it('picks nothing for a complete budget lineup', () => {
    const summary = { selectionType: SelectionType.BUDGET_PICK, salaryCap: 1000, spent: 300, remaining: 700, isOverBudget: false, openSlots: 0, cheapestFill: 0 };

    expect(choosePicks(state(SelectionType.BUDGET_PICK, [group(1, 2, [row('x', 100)])], summary), 0)).toEqual([]);
  });
});

describe('test participants: where and under what name', () => {
  it('refuses staging and prod and takes QA and the local environments', () => {
    for (const environment of ['qa', 'development', 'test', 'ci']) expect(() => refuseUnlessTestTarget(environment, 'Loading test participants')).not.toThrow();
    expect(() => refuseUnlessTestTarget('staging', 'Loading every test data file')).toThrow('Loading every test data file is for QA only, and this site is staging.');
    expect(() => refuseUnlessTestTarget('prod', 'Loading test participants')).toThrow('this site is prod');
  });

  it('gives each sport league its own stable league code, even when their names start alike', () => {
    const men = testLeagueCode(Sport.RUNNING, 'World Marathon Majors (men)');
    const women = testLeagueCode(Sport.RUNNING, 'World Marathon Majors (women)');

    expect(men).toMatch(/^[A-Z0-9]{3,16}$/);
    expect(men).not.toBe(women);
    expect(testLeagueCode(Sport.RUNNING, 'World Marathon Majors (men)')).toBe(men);
  });

  it('keeps college basketball and college hockey in separate test pools though their leagues share a name', () => {
    expect(testLeagueCode(Sport.HOCKEY, 'NCAA Division I Men')).not.toBe(testLeagueCode(Sport.BASKETBALL, 'NCAA Division I Men'));
    expect(testLeagueName(Sport.HOCKEY, 'NCAA Division I Men')).toBe('NCAA Division I Men Hockey test pool');
    expect(testLeagueName(Sport.BASKETBALL, 'NCAA Division I Men')).toBe('NCAA Division I Men Basketball test pool');
  });

  it('shows test participant rows in the report only on a run that loads them', () => {
    const file = {
      scope: { sport: 'HORSE_RACING', season: 2026, sportLeagues: ['US Thoroughbred'], contents: ['SCHEDULE'] },
      testData: true,
      provenance: { gatheredAt: '2026-10-01', gatheredBy: 'test', sources: [{ name: 'Source', url: 'https://example.com' }] },
      sportLeagues: [],
      schemaVersion: 1,
    } as unknown as SportDataFile;

    expect(formatLoadReport(file, LoadMode.APPLY, [])).not.toContain('| Entry |');
    const report = formatLoadReport(file, LoadMode.APPLY, [
      { sportLeague: 'US Thoroughbred', subject: LoadSubject.ENTRY, action: LoadAction.ADD, name: 'Kentucky Derby picks: Avery Adams', detail: 'entered, picked and submitted' },
    ]);
    expect(report).toContain('| Entry | 1 | 0 | 0 | 0 |');
    expect(report).not.toContain('| Contest |');
  });
});

describe('test participants: which template a test contest is built from', () => {
  const NFL = '00000000-0000-4000-8000-000000000001';

  function template(templateKey: string, fields: Partial<Template>): Template {
    return {
      id: `tpl-${templateKey}`, sport: Sport.AMERICAN_FOOTBALL, sportLeagueId: NFL, eventType: ContestTemplateEventType.KNOCKOUT,
      contestFormat: ContestFormat.ROSTER, selectionType: SelectionType.TIERED, templateKey, name: templateKey, description: templateKey,
      sortOrder: 1, isDefault: false, active: true, schemaVersion: 1,
      configuration: { selectionType: SelectionType.TIERED, picksPerTier: 1, maxEntriesPerSquad: 1 },
      ...fields,
    } as Template;
  }

  // The NFL's templates as seeded: roster ones for the playoffs, pick'em and survivor for a week, squares on any game.
  const nflTemplates = [
    template('nfl-tiered-doubling', { sortOrder: 1 }),
    template('nfl-budget-doubling', { selectionType: SelectionType.BUDGET_PICK, sortOrder: 2, isDefault: true }),
    template('nfl-random-draw-doubling', { selectionType: SelectionType.RANDOM_DRAW, sortOrder: 3, isDefault: true }),
    template('nfl-pick-em-straight-up', { eventType: ContestTemplateEventType.WEEK, contestFormat: ContestFormat.PREDICTION, selectionType: SelectionType.PICK_EM, isDefault: true }),
    template('nfl-survivor', { eventType: ContestTemplateEventType.WEEK, contestFormat: ContestFormat.PREDICTION, selectionType: SelectionType.SURVIVOR, sortOrder: 4, isDefault: true }),
    template('nfl-squares', { eventType: null, contestFormat: ContestFormat.SQUARES, selectionType: SelectionType.SQUARES, sortOrder: 10, isDefault: true }),
  ];

  it('builds no test contest on an NFL week, which offers no roster template, instead of borrowing a playoff template whose round values do not fit one round', () => {
    const week = { sport: Sport.AMERICAN_FOOTBALL, sportLeagueId: NFL, rounds: 1 };

    expect(chooseContestTemplate(nflTemplates, week)).toBeNull();
  });

  it('builds a playoff test contest from the league\'s default roster template, never a draw', () => {
    const playoffs = { sport: Sport.AMERICAN_FOOTBALL, sportLeagueId: NFL, rounds: 4 };

    expect(chooseContestTemplate(nflTemplates, playoffs)?.templateKey).toBe('nfl-budget-doubling');
  });

  it('prefers the sport league\'s own template to a sport-wide one for a sport whose events are all one kind', () => {
    const golf = (templateKey: string, sportLeagueId: string | null, isDefault: boolean) =>
      template(templateKey, { sport: Sport.GOLF, sportLeagueId, eventType: null, isDefault });
    const tournament = { sport: Sport.GOLF, sportLeagueId: NFL, rounds: 4 };

    expect(chooseContestTemplate([golf('golf-tiered-pick-6', null, true), golf('tour-tiered', NFL, false)], tournament)?.templateKey).toBe('tour-tiered');
  });
});
