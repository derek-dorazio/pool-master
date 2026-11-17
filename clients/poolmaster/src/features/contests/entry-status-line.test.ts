import { describe, expect, it } from 'vitest';
import { entryFinishStatus, entryStatusLine } from './entry-status-line';

describe('entryStatusLine', () => {
  it('says an open entry that is not submitted when to submit by, and a submitted one until when it can change', () => {
    expect(entryStatusLine({ closes: 'Thu 8:15 PM', isOpen: true, status: 'DRAFT' })).toBe('Not submitted · submit by Thu 8:15 PM');
    expect(entryStatusLine({ closes: 'Thu 8:15 PM', isOpen: true, status: 'SUBMITTED' })).toBe('Submitted · change until Thu 8:15 PM');
  });

  it('says only the status once picks have closed, and that a hidden entry stays hidden', () => {
    expect(entryStatusLine({ closes: 'Thu 8:15 PM', isOpen: false, status: 'SUBMITTED' })).toBe('Submitted');
    expect(entryStatusLine({ closes: 'Thu 8:15 PM', isOpen: false, status: 'DRAFT' })).toBe('Not submitted');
    expect(entryStatusLine({ closes: 'Thu 8:15 PM', isOpen: true, status: null })).toBe('Hidden until the event starts');
  });
});

describe('entryFinishStatus', () => {
  it('ticks a submitted entry, else says what blocks Submit, else when to submit by', () => {
    expect(entryFinishStatus({ closes: 'kickoff', hint: 'Pick every game to submit: 2 still to pick.', isSubmitted: true })).toBe('✓ Submitted · change until kickoff');
    expect(entryFinishStatus({ closes: 'kickoff', hint: 'Pick every game to submit: 2 still to pick.', isSubmitted: false })).toBe('Pick every game to submit: 2 still to pick.');
    expect(entryFinishStatus({ closes: 'Thu 8:15 PM', hint: null, isSubmitted: false })).toBe('Submit by Thu 8:15 PM');
  });
});
