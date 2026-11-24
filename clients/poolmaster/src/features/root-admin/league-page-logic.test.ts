import { describe, expect, it } from 'vitest';
import type { DisplayPreferences } from '@/features/shared/ui';
import type { SportLeagueParticipantOverviewDto, SportLeagueSyncDto } from '@/lib/api';
import { contestTemplateUpdateBody, contestTemplateValuesOf } from './league-contest-template-form';
import { defaultEventYear } from './league-event-columns';
import { isSyncedLeague, leaguePageTabs } from './league-page-context';
import { failedJobCount } from './use-activity';
import { leagueParticipantColumnIds } from './league-participant-columns';
import { editableParticipantFields, participantUpdateBody, participantValuesOf } from './league-participant-form';
import { lastRunText, syncModeText } from './league-syncs-text';
import { providerMappingFixture } from './sport-test-fixtures';

// The League page's rules (#1866) that need no screen: its tabs, its grids' columns and defaults,
// and what its dialogs send.

const PREFERENCES: DisplayPreferences = { timeZone: 'UTC', locale: 'en-US', hour12: true };

function participant(overrides: Partial<SportLeagueParticipantOverviewDto> = {}): SportLeagueParticipantOverviewDto {
  return {
    id: 'p-1',
    name: 'Scottie Scheffler',
    participantType: 'INDIVIDUAL',
    shortName: null,
    nationality: null,
    teamAffiliation: null,
    role: null,
    ranking: null,
    feedId: null,
    lastInFeedAt: null,
    addedBy: 'ADMIN',
    createdAt: '2027-01-01T00:00:00.000Z',
    ...overrides,
  };
}

describe('leaguePageTabs', () => {
  it('shows Events, Participants, Activity, Contest templates and Structure on a synced league, and adds Tools only on a league no provider syncs', () => {
    expect(leaguePageTabs(true).map((tab) => tab.label)).toEqual(['Events', 'Participants', 'Activity', 'Contest templates', 'Structure']);
    expect(leaguePageTabs(false).map((tab) => tab.label)).toEqual(['Events', 'Participants', 'Activity', 'Contest templates', 'Structure', 'Tools']);
  });
});

describe('failedJobCount', () => {
  it('counts only the failed jobs', () => {
    expect(failedJobCount([{ status: 'FAILED' }, { status: 'SUCCEEDED' }, { status: 'FAILED' }, { status: 'RUNNING' }])).toBe(2);
    expect(failedJobCount([])).toBe(0);
  });
});

describe('isSyncedLeague', () => {
  it('takes the overview\'s provider once read, and the league\'s own setting before', () => {
    expect(isSyncedLeague({ selectedProviderMapping: null }, { providerId: 'balldontlie' })).toBe(true);
    expect(isSyncedLeague({ selectedProviderMapping: providerMappingFixture() }, { providerId: null })).toBe(false);
    expect(isSyncedLeague({ selectedProviderMapping: providerMappingFixture() }, undefined)).toBe(true);
    expect(isSyncedLeague({ selectedProviderMapping: null }, undefined)).toBe(false);
  });
});

describe('defaultEventYear', () => {
  const now = new Date('2027-06-01T00:00:00.000Z');

  it('opens on the league\'s current event year, else this calendar year, when an event is in it', () => {
    expect(defaultEventYear([{ eventYear: 2026 }, { eventYear: 2027 }], 2026, now)).toBe(2026);
    expect(defaultEventYear([{ eventYear: 2026 }, { eventYear: 2027 }], null, now)).toBe(2027);
  });

  it('opens on no year when no event is in that year, so the grid never opens empty', () => {
    expect(defaultEventYear([{ eventYear: 2025 }], null, now)).toBeNull();
    expect(defaultEventYear([], 2027, now)).toBeNull();
  });
});

describe('leagueParticipantColumnIds', () => {
  it('gives individual players Country and teams Short name', () => {
    const golfers = [participant({ nationality: 'USA', ranking: 1, feedId: 'bdl-1', lastInFeedAt: '2027-01-02T00:00:00.000Z' })];
    expect(leagueParticipantColumnIds(golfers)).toEqual(['ranking', 'nationality', 'feedId', 'lastInFeedAt']);

    const teams = [participant({ participantType: 'TEAM', name: 'Boston Celtics', shortName: 'BOS', nationality: 'USA' })];
    expect(leagueParticipantColumnIds(teams)).toEqual(['shortName']);
  });

  it('gives players with a team and position the Team and Position columns', () => {
    const players = [participant({ teamAffiliation: 'Dodgers', role: 'SS', nationality: 'USA' })];
    expect(leagueParticipantColumnIds(players)).toEqual(['nationality', 'teamAffiliation', 'role']);
  });

  it('leaves out a column no participant has a value for, so none is blank for the whole league', () => {
    expect(leagueParticipantColumnIds([participant(), participant({ id: 'p-2' })])).toEqual([]);
    expect(leagueParticipantColumnIds([participant(), participant({ id: 'p-2', ranking: 4 })])).toEqual(['ranking']);
  });
});

describe('participant dialog form', () => {
  it('lets a feed participant\'s short name, country and rank change, and a hand-added one\'s name, team and position too', () => {
    expect(editableParticipantFields({ addedBy: 'FEED' })).toEqual(['shortName', 'nationality', 'ranking']);
    expect(editableParticipantFields({ addedBy: 'ADMIN' })).toEqual(['name', 'shortName', 'nationality', 'ranking', 'teamAffiliation', 'role']);
  });

  it('sends only the changed fields, an emptied rank as unranked', () => {
    const current = participantValuesOf(participant({ shortName: 'Scottie', ranking: 1 }));

    expect(participantUpdateBody(current, { ...current, shortName: 'S. Scheffler' })).toEqual({ shortName: 'S. Scheffler' });
    expect(participantUpdateBody(current, { ...current, ranking: '' })).toEqual({ ranking: null });
    expect(participantUpdateBody(current, { ...current, ranking: '3' })).toEqual({ ranking: 3 });
    expect(participantUpdateBody(current, current)).toEqual({});
  });
});

describe('contest template dialog form', () => {
  it('sends only a changed Status or Default', () => {
    const current = contestTemplateValuesOf({ active: true, isDefault: false });

    expect(contestTemplateUpdateBody(current, { active: 'off', isDefault: 'no' })).toEqual({ active: false });
    expect(contestTemplateUpdateBody(current, { active: 'on', isDefault: 'yes' })).toEqual({ isDefault: true });
  });
});

describe('sync row text', () => {
  const run: NonNullable<SportLeagueSyncDto['lastRun']> = {
    id: 'run-1',
    status: 'COMPLETED',
    createdAt: '2027-03-01T12:00:00.000Z',
    startedAt: '2027-03-01T12:00:05.000Z',
    summary: 'Imported 3 events',
    changedCount: 3,
  };

  it('says how the last run went: what it changed, or its summary when it counted nothing, or that none ran', () => {
    expect(lastRunText({ lastRun: run }, PREFERENCES)).toMatch(/^Last run .* · done · 3 changed$/);
    expect(lastRunText({ lastRun: { ...run, status: 'FAILED', changedCount: null, summary: '429 rate limit' } }, PREFERENCES)).toMatch(/· failed · 429 rate limit$/);
    expect(lastRunText({ lastRun: null }, PREFERENCES)).toBe('Never run');
  });

  it('says whether the webhook or the ingestion schedule drives a sync', () => {
    expect(syncModeText({ mode: 'SCHEDULE' })).toBe('Runs on the ingestion schedule');
    expect(syncModeText({ mode: 'WEBHOOK' })).toBe('Follows the webhook, with a poll while an event is live');
  });
});
