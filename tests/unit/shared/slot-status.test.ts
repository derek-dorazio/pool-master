import { isSlotChangedAfterCompleted, MatchStatus, ScoringFamily, SeasonSlotStatus, SportEventStatus, seasonSlotStatusOf, sportEventStatusOfSlots } from '@poolmaster/shared/domain';

const facts = (matchStatuses: MatchStatus[], overrides: { current?: SeasonSlotStatus; feedFinal?: boolean } = {}) => ({
  current: overrides.current ?? SeasonSlotStatus.SCHEDULED,
  matchStatuses,
  feedFinal: overrides.feedFinal ?? false,
});

describe('seasonSlotStatusOf', () => {
  it('keeps a slot scheduled while every Match is scheduled or postponed, and one with no Match yet', () => {
    expect(seasonSlotStatusOf(ScoringFamily.HEAD_TO_HEAD, facts([MatchStatus.SCHEDULED, MatchStatus.POSTPONED]))).toBe(SeasonSlotStatus.SCHEDULED);
    expect(seasonSlotStatusOf(ScoringFamily.HEAD_TO_HEAD, facts([]))).toBe(SeasonSlotStatus.SCHEDULED);
  });

  it('puts a slot in progress once any Match has started or is decided while others are still to play', () => {
    expect(seasonSlotStatusOf(ScoringFamily.HEAD_TO_HEAD, facts([MatchStatus.IN_PROGRESS, MatchStatus.SCHEDULED]))).toBe(SeasonSlotStatus.IN_PROGRESS);
    expect(seasonSlotStatusOf(ScoringFamily.HEAD_TO_HEAD, facts([MatchStatus.COMPLETED, MatchStatus.SCHEDULED]))).toBe(SeasonSlotStatus.IN_PROGRESS);
  });

  it('completes a slot of matches, or of races, once every Match is completed or cancelled', () => {
    for (const family of [ScoringFamily.HEAD_TO_HEAD, ScoringFamily.FINISH_POSITION]) {
      expect(seasonSlotStatusOf(family, facts([MatchStatus.COMPLETED, MatchStatus.CANCELLED]))).toBe(SeasonSlotStatus.COMPLETED);
    }
  });

  it('completes a stroke-play slot only on the feed\'s final call, not when every round played so far is complete', () => {
    expect(seasonSlotStatusOf(ScoringFamily.STROKE_PLAY, facts([MatchStatus.COMPLETED, MatchStatus.COMPLETED, MatchStatus.COMPLETED]))).toBe(SeasonSlotStatus.IN_PROGRESS);
    expect(seasonSlotStatusOf(ScoringFamily.STROKE_PLAY, facts([MatchStatus.COMPLETED, MatchStatus.COMPLETED, MatchStatus.COMPLETED], { feedFinal: true }))).toBe(SeasonSlotStatus.COMPLETED);
  });

  it('never moves a completed or cancelled slot, whatever its Matches do afterwards', () => {
    expect(seasonSlotStatusOf(ScoringFamily.HEAD_TO_HEAD, facts([MatchStatus.IN_PROGRESS], { current: SeasonSlotStatus.COMPLETED }))).toBe(SeasonSlotStatus.COMPLETED);
    expect(seasonSlotStatusOf(ScoringFamily.HEAD_TO_HEAD, facts([MatchStatus.COMPLETED], { current: SeasonSlotStatus.CANCELLED }))).toBe(SeasonSlotStatus.CANCELLED);
  });
});

describe('isSlotChangedAfterCompleted', () => {
  const completed = { current: SeasonSlotStatus.COMPLETED };

  it('flags a completed slot whose Matches no longer complete it, as when a late result moves one back in progress', () => {
    expect(isSlotChangedAfterCompleted(ScoringFamily.HEAD_TO_HEAD, facts([MatchStatus.COMPLETED, MatchStatus.IN_PROGRESS], completed))).toBe(true);
    expect(isSlotChangedAfterCompleted(ScoringFamily.FINISH_POSITION, facts([MatchStatus.SCHEDULED], completed))).toBe(true);
  });

  it('flags a completed stroke-play slot once the feed takes back its final call', () => {
    expect(isSlotChangedAfterCompleted(ScoringFamily.STROKE_PLAY, facts([MatchStatus.COMPLETED], completed))).toBe(true);
    expect(isSlotChangedAfterCompleted(ScoringFamily.STROKE_PLAY, facts([MatchStatus.COMPLETED], { ...completed, feedFinal: true }))).toBe(false);
  });

  it('never flags a completed slot its Matches still complete, a completed slot with no Matches, or a slot not yet completed', () => {
    expect(isSlotChangedAfterCompleted(ScoringFamily.HEAD_TO_HEAD, facts([MatchStatus.COMPLETED, MatchStatus.CANCELLED], completed))).toBe(false);
    expect(isSlotChangedAfterCompleted(ScoringFamily.HEAD_TO_HEAD, facts([], completed))).toBe(false);
    expect(isSlotChangedAfterCompleted(ScoringFamily.HEAD_TO_HEAD, facts([MatchStatus.IN_PROGRESS], { current: SeasonSlotStatus.IN_PROGRESS }))).toBe(false);
    expect(isSlotChangedAfterCompleted(ScoringFamily.HEAD_TO_HEAD, facts([MatchStatus.IN_PROGRESS], { current: SeasonSlotStatus.CANCELLED }))).toBe(false);
  });
});

describe('sportEventStatusOfSlots', () => {
  it('leaves an event with no slots to its own status', () => {
    expect(sportEventStatusOfSlots([])).toBeNull();
  });

  it('schedules an event while every slot is scheduled, and puts it in progress once any slot has started', () => {
    expect(sportEventStatusOfSlots([SeasonSlotStatus.SCHEDULED, SeasonSlotStatus.SCHEDULED])).toBe(SportEventStatus.SCHEDULED);
    expect(sportEventStatusOfSlots([SeasonSlotStatus.COMPLETED, SeasonSlotStatus.SCHEDULED])).toBe(SportEventStatus.IN_PROGRESS);
  });

  it('completes an event once every slot is completed or cancelled, and cancels it only when every slot is cancelled', () => {
    expect(sportEventStatusOfSlots([SeasonSlotStatus.COMPLETED, SeasonSlotStatus.CANCELLED])).toBe(SportEventStatus.COMPLETED);
    expect(sportEventStatusOfSlots([SeasonSlotStatus.CANCELLED, SeasonSlotStatus.CANCELLED])).toBe(SportEventStatus.CANCELLED);
  });
});
