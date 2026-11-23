import { enumLabel } from '@poolmaster/shared/display-strings';
import {
  ContestTemplateEventType,
  MatchEnding,
  ProviderSyncKind,
  RaceResultRowError,
  SportEventReleaseMode,
} from '@poolmaster/shared/domain';
import { describe, expect, it } from 'vitest';
import { matchEndingMark } from './bracket-copy';
import { syncScopeLabel } from './sport-admin-utils';
import { syncFailedText } from './sport-league-overview-text';

/**
 * #1959: root admin reads its words from the display strings. Where root admin says a code
 * differently from a tighter space, the entry carries both forms, and these pin that the admin
 * screens kept their words when their own maps were deleted.
 */
describe('root admin words come from the display strings', () => {
  it('a contest template dialog names the event type in full, while a tile asks for the short form', () => {
    expect(enumLabel('ContestTemplateEventType', ContestTemplateEventType.KNOCKOUT)).toBe('Playoffs and brackets');
    expect(enumLabel('ContestTemplateEventType', ContestTemplateEventType.WEEK)).toBe('A week of games');
    expect(enumLabel('ContestTemplateEventType', ContestTemplateEventType.KNOCKOUT, { form: 'short' })).toBe('Playoffs');
    expect(enumLabel('ContestTemplateEventType', ContestTemplateEventType.WEEK, { form: 'short' })).toBe('Weekly');
  });

  it('the release checks dialog spells out Automatic, and the Events grid column says Auto', () => {
    expect(enumLabel('SportEventReleaseMode', SportEventReleaseMode.AUTO)).toBe('Automatic');
    expect(enumLabel('SportEventReleaseMode', SportEventReleaseMode.AUTO, { form: 'short' })).toBe('Auto');
    expect(enumLabel('SportEventReleaseMode', SportEventReleaseMode.MANUAL, { form: 'short' })).toBe('Manual');
  });

  it('a match that stopped early is marked ret., w/o or def., and a played match has no mark', () => {
    expect(matchEndingMark(MatchEnding.PLAYED)).toBeNull();
    expect(matchEndingMark(MatchEnding.RETIREMENT)).toBe('ret.');
    expect(matchEndingMark(MatchEnding.WALKOVER)).toBe('w/o');
    expect(matchEndingMark(MatchEnding.DEFAULT)).toBe('def.');
  });

  it('an event with no feed reads Manual, and one whose scores sync reads Scores synced', () => {
    expect(syncScopeLabel('NONE')).toBe('Manual');
    expect(syncScopeLabel('SCORES_ONLY')).toBe('Scores synced');
  });

  it('a race result preview row says what is wrong with it in the admin’s words', () => {
    expect(enumLabel('RaceResultRowError', RaceResultRowError.DUPLICATE_PARTICIPANT)).toBe('Named on another row too');
    expect(enumLabel('RaceResultRowError', RaceResultRowError.POSITION_WITHOUT_FINISH)).toBe('A place, but it did not finish');
    expect(enumLabel('RaceResultRowError', RaceResultRowError.FINISH_WITHOUT_POSITION)).toBe('Finished, but has no place');
  });

  it('a failed sync chip names each sync kind in domain words', () => {
    expect(syncFailedText(ProviderSyncKind.EVENTS)).toBe('Event list sync failed');
    expect(syncFailedText(ProviderSyncKind.FIELD)).toBe('Field sync failed');
    expect(syncFailedText(ProviderSyncKind.SCORES)).toBe('Live scores and results sync failed');
  });
});
