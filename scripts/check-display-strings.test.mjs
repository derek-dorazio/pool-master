import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  apiErrorCodes,
  completenessFailures,
  findLabelMaps,
  flatKeys,
  labelMapFailures,
  parityFailures,
  registeredEnumNames,
  sharedEnumNames,
  unregisteredEnums,
  unusedKeyFailures,
} from './check-display-strings.mjs';

const ENUMS = { ContestStatus: ['DRAFT', 'OPEN'], Sport: ['GOLF'] };
const ERRORS = ['CONTEST_FULL'];
const COMPLETE = {
  enum: { ContestStatus: { DRAFT: 'Set up', OPEN: 'Open' }, Sport: { GOLF: { name: 'Golf', short: 'Golf' } } },
  error: { CONTEST_FULL: 'This contest is full.' },
  word: {},
  sport: {},
};

describe('check-display-strings (#1956)', () => {
  it('reads the enums enums.ts declares, the enums SharedEnums lists and the API error codes', () => {
    assert.deepEqual(sharedEnumNames("export const Sport = {\n  GOLF: 'GOLF',\n} as const;\n"), ['Sport']);
    assert.deepEqual(registeredEnumNames('export type SharedEnums = {\n  Sport: Enums.Sport;\n  ContestStatus: Enums.ContestStatus;\n};'), ['Sport', 'ContestStatus']);
    assert.deepEqual(apiErrorCodes("export const API_ERROR_CODES = [\n  'A_CODE',\n  'B_CODE',\n] as const;\nconst x = [\n  'NOT_ONE',\n];"), ['A_CODE', 'B_CODE']);
  });

  it('fails an enum added to enums.ts without a SharedEnums entry, naming the enum', () => {
    const failures = unregisteredEnums(['Sport', 'CupStatus'], ['Sport']);
    assert.equal(failures.length, 1);
    assert.match(failures[0], /leaves out CupStatus/);
  });

  it('passes a module with words for every enum value and error code', () => {
    assert.deepEqual(completenessFailures('en-US', COMPLETE, ENUMS, ERRORS), []);
  });

  it('fails a new enum value with no display string, naming the enum and the code', () => {
    const failures = completenessFailures('en-US', COMPLETE, { ...ENUMS, ContestStatus: ['DRAFT', 'OPEN', 'LIVE'] }, ERRORS);
    assert.deepEqual(failures, ['en-US: enum ContestStatus has no display string for LIVE.']);
  });

  it('fails a new enum with no display strings at all, and an entry for an enum that no longer exists', () => {
    assert.deepEqual(completenessFailures('en-US', COMPLETE, { ...ENUMS, CupStatus: ['OPEN'] }, ERRORS), ['en-US: enum CupStatus has no display strings.']);
    assert.deepEqual(completenessFailures('en-US', COMPLETE, { ContestStatus: ENUMS.ContestStatus }, ERRORS), [
      'en-US: Sport has display strings but is not a shared enum.',
    ]);
  });

  it('fails a display string for a value the enum no longer has', () => {
    const failures = completenessFailures('en-US', COMPLETE, { ...ENUMS, ContestStatus: ['DRAFT'] }, ERRORS);
    assert.deepEqual(failures, ['en-US: enum ContestStatus has a display string for OPEN, which is not one of its values.']);
  });

  it('fails a new error code with no message, and a message for a code the API no longer sends', () => {
    assert.deepEqual(completenessFailures('en-US', COMPLETE, ENUMS, ['CONTEST_FULL', 'CUP_CROWNED']), ['en-US: error code CUP_CROWNED has no display string.']);
    assert.deepEqual(completenessFailures('en-US', COMPLETE, ENUMS, []), ['en-US: error CONTEST_FULL has a display string but is not an API error code.']);
  });

  it('lists a module\'s keys flat, with a short form as its own key', () => {
    assert.deepEqual(flatKeys(COMPLETE), [
      'enum.ContestStatus.DRAFT',
      'enum.ContestStatus.OPEN',
      'enum.Sport.GOLF',
      'enum.Sport.GOLF.short',
      'error.CONTEST_FULL',
    ]);
  });

  it('fails a word key no source uses, and passes one used through its plural base', () => {
    const module = { ...COMPLETE, word: { weekNumber: 'Week {{n}}', roundCount_one: 'x', roundCount_other: 'y' } };
    const failures = unusedKeyFailures(module, ["displayString('word.roundCount', { count })"]);
    assert.deepEqual(failures, ['en-US: word.weekNumber is used nowhere. Delete it, or use it through displayString.']);
  });

  it('passes sport word entries and their roles\' generic words, read by role, and fails a sport entry whose role is not a sport word role', () => {
    const module = {
      ...COMPLETE,
      word: { participant_one: 'participant', participant_other: 'participants' },
      sport: { GOLF: { participant_one: 'golfer', participant_other: 'golfers', caddie: 'Caddie' } },
    };
    assert.deepEqual(unusedKeyFailures(module, [], ['participant']), [
      'en-US: sport.GOLF.caddie is not a sport word role. Add caddie to SPORT_WORD_ROLES, or delete it.',
    ]);
  });

  it('fails a plural with a _one form and no _other form', () => {
    const module = { ...COMPLETE, word: { roundCount_one: 'x' } };
    assert.deepEqual(unusedKeyFailures(module, ["'word.roundCount'"]), ['en-US: word.roundCount_one has no word.roundCount_other.']);
  });

  it('fails a language that misses an en-US key or has one en-US does not', () => {
    const french = { ...COMPLETE, enum: { ...COMPLETE.enum, Sport: { GOLF: 'Golf' } }, word: { extra: 'en trop' } };
    assert.deepEqual(parityFailures('fr-FR', french, COMPLETE), [
      'fr-FR: missing enum.Sport.GOLF.short, which en-US has.',
      'fr-FR: has word.extra, which en-US does not.',
    ]);
    assert.deepEqual(parityFailures('fr-FR', COMPLETE, COMPLETE), []);
  });

  it('fails a language whose entry has other placeholders than the en-US entry', () => {
    const english = { ...COMPLETE, word: { weekNumber: 'Week {{n}}' } };
    const french = { ...COMPLETE, word: { weekNumber: 'Semaine {{number}}' } };
    assert.deepEqual(parityFailures('fr-FR', french, english), ['fr-FR: word.weekNumber has placeholders {number}, but en-US has {n}.']);
  });

  it('finds a Record of an enum or of ApiErrorCode to strings, wrapped or not, and skips comment lines', () => {
    const source = [
      'const A: Record<ContestStatus, string> = {};',
      'type M = Partial<Record<ApiErrorCode, string>>;',
      '// const B: Record<Sport, string> = {};',
      'const C: Record<Sport, number> = {};',
      'const D: Readonly<Record<LogLevel, string>> = {};',
    ].join('\n');
    assert.deepEqual(findLabelMaps(source, ['ContestStatus', 'Sport']), [
      { enumName: 'ContestStatus', line: 1 },
      { enumName: 'ApiErrorCode', line: 2 },
    ]);
  });

  it('passes a label map on the allowlist, fails one that is not, and fails an allowlist entry whose map is gone', () => {
    const maps = { 'web/a.ts': [{ enumName: 'Sport', line: 3 }], 'web/b.ts': [{ enumName: 'ContestStatus', line: 9 }] };
    const failures = labelMapFailures(maps, { 'web/a.ts': ['Sport'], 'web/c.ts': ['CupTrophy'] });
    assert.equal(failures.length, 2);
    assert.match(failures[0], /^web\/b\.ts:9 maps ContestStatus to words of its own/);
    assert.match(failures[1], /web\/c\.ts no longer maps CupTrophy to words/);
    assert.deepEqual(labelMapFailures(maps, { 'web/a.ts': ['Sport'], 'web/b.ts': ['ContestStatus'] }), []);
  });

  it('counts two maps of the same enum in one file as two allowlist entries', () => {
    const maps = { 'web/a.ts': [{ enumName: 'PlanCap', line: 1 }, { enumName: 'PlanCap', line: 9 }] };
    assert.equal(labelMapFailures(maps, { 'web/a.ts': ['PlanCap'] }).length, 1);
    assert.deepEqual(labelMapFailures(maps, { 'web/a.ts': ['PlanCap', 'PlanCap'] }), []);
  });
});
