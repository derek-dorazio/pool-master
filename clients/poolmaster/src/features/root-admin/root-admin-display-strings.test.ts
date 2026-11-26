import { enumLabel } from '@poolmaster/shared/display-strings';
import {
  FieldValueSetBy,
  GolfRoundScoreChange,
  MatchEnding,
  ProviderSyncKind,
  RaceResultChange,
  RaceResultRowError,
  ReleaseCheckKey,
  SportEventReleaseMode,
  TemplateCoverageMode,
} from '@poolmaster/shared/domain';
import { describe, expect, it } from 'vitest';
import { syncFailedText } from './sport-league-overview-text';

/**
 * #1959: root admin reads its words from the display strings. Where root admin says a code
 * differently from a tighter space, the entry carries both forms, and these pin that the admin
 * screens kept their words when their own maps were deleted.
 */
describe('root admin words come from the display strings', () => {
  it('a contest template dialog says how a template covers its slots in words, not codes', () => {
    expect(enumLabel('TemplateCoverageMode', TemplateCoverageMode.ONE_SLOT)).toBe('One of these');
    expect(enumLabel('TemplateCoverageMode', TemplateCoverageMode.ALL_LISTED)).toBe('All of these');
    expect(enumLabel('TemplateCoverageMode', TemplateCoverageMode.FROM_SLOT)).toBe('From one of these on');
  });

  it('the release checks dialog spells out Automatic, and the Events grid column says Auto', () => {
    expect(enumLabel('SportEventReleaseMode', SportEventReleaseMode.AUTO)).toBe('Automatic');
    expect(enumLabel('SportEventReleaseMode', SportEventReleaseMode.AUTO, { form: 'short' })).toBe('Auto');
    expect(enumLabel('SportEventReleaseMode', SportEventReleaseMode.MANUAL, { form: 'short' })).toBe('Manual');
  });

  it('a match that stopped early is marked ret., w/o or def. in the short form', () => {
    expect(enumLabel('MatchEnding', MatchEnding.RETIREMENT, { form: 'short' })).toBe('ret.');
    expect(enumLabel('MatchEnding', MatchEnding.WALKOVER, { form: 'short' })).toBe('w/o');
    expect(enumLabel('MatchEnding', MatchEnding.DEFAULT, { form: 'short' })).toBe('def.');
  });

  it('a race result preview row says what is wrong with it in the admin’s words', () => {
    expect(enumLabel('RaceResultRowError', RaceResultRowError.DUPLICATE_PARTICIPANT)).toBe('Named on another row too');
    expect(enumLabel('RaceResultRowError', RaceResultRowError.POSITION_WITHOUT_FINISH)).toBe('A place, but it did not finish');
    expect(enumLabel('RaceResultRowError', RaceResultRowError.FINISH_WITHOUT_POSITION)).toBe('Finished, but has no place');
  });

  it('a race result preview row says whether it is new, changed or unchanged', () => {
    expect(enumLabel('RaceResultChange', RaceResultChange.CREATE)).toBe('New');
    expect(enumLabel('RaceResultChange', RaceResultChange.UPDATE)).toBe('Changed');
    expect(enumLabel('RaceResultChange', RaceResultChange.UNCHANGED)).toBe('Unchanged');
  });

  it('a golf round-score preview row reads New, Changed, Unchanged or Not stored, never its raw code', () => {
    expect(enumLabel('GolfRoundScoreChange', GolfRoundScoreChange.CREATE)).toBe('New');
    expect(enumLabel('GolfRoundScoreChange', GolfRoundScoreChange.UPDATE)).toBe('Changed');
    expect(enumLabel('GolfRoundScoreChange', GolfRoundScoreChange.UNCHANGED)).toBe('Unchanged');
    expect(enumLabel('GolfRoundScoreChange', GolfRoundScoreChange.SKIPPED)).toBe('Not stored (no strokes)');
  });

  it('a held release names each failed ready check in the admin’s words', () => {
    expect(enumLabel('ReleaseCheckKey', ReleaseCheckKey.TIERS_ASSIGNED)).toBe('Every participant in a tier');
    expect(enumLabel('ReleaseCheckKey', ReleaseCheckKey.CONTEST_SETUPS_ON)).toBe('Contest template on');
  });

  it('a field row says whether its tier and price were set automatically or by a root admin', () => {
    expect(enumLabel('FieldValueSetBy', FieldValueSetBy.AUTO)).toBe('Auto');
    expect(enumLabel('FieldValueSetBy', FieldValueSetBy.MANUAL)).toBe('Manual');
  });

  it('the field sync is called Field on the League page, the Event page and the failed chip alike', () => {
    expect(enumLabel('ProviderSyncKind', ProviderSyncKind.FIELD)).toBe('Field');
  });

  it('a failed sync chip names each sync kind in domain words', () => {
    expect(syncFailedText(ProviderSyncKind.EVENTS)).toBe('Event list sync failed');
    expect(syncFailedText(ProviderSyncKind.FIELD)).toBe('Field sync failed');
    expect(syncFailedText(ProviderSyncKind.SCORES)).toBe('Live scores and results sync failed');
  });
});
