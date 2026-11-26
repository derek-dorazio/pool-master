import { describe, expect, it } from 'vitest';
import type { ContestConfigTemplateDto } from '@/lib/api';
import { templateCoversLabel } from './league-contest-template-covers';

type Slot = ContestConfigTemplateDto['slots'][number];

function slot(overrides: Partial<Slot>): Slot {
  return { id: 'slot', key: 'FINAL', name: null, slotKind: 'FINAL', weekNumber: null, sportLeagueCompetitionId: 'postseason', competitionCode: 'POSTSEASON', competitionOrderIndex: 1, phase: 'POSTSEASON', matchFormat: 'HEAD_TO_HEAD', ...overrides };
}

describe('the Covers fact of a contest template', () => {
  it('names the coverage mode, then each slot by its proper name, else its week or its kind, in the order the API sends them', () => {
    expect(templateCoversLabel({
      coverageMode: 'FROM_SLOT',
      slots: [slot({ key: 'WEEK_1', slotKind: 'WEEK', weekNumber: 1, phase: 'REGULAR' }), slot({ key: 'SEMIFINAL', slotKind: 'SEMIFINAL' }), slot({ name: 'Super Bowl' })],
    })).toBe('From one of these on: Week 1, Semifinal, Super Bowl');
  });

  it('says a template with no slots covers none, so it is offered on no event', () => {
    expect(templateCoversLabel({ coverageMode: 'ONE_SLOT', slots: [] })).toBe('No slots');
  });
});
