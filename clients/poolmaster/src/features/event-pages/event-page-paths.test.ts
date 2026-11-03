import { SelectionType, Sport } from '@poolmaster/shared/domain';
import { describe, expect, it } from 'vitest';
import { buildHowToPlayFormatPath, howToPlayFormatAnchor } from './event-page-paths';

describe('buildHowToPlayFormatPath', () => {
  it('opens How to Play at the contest\'s sport on its way to play', () => {
    expect(buildHowToPlayFormatPath(Sport.HORSE_RACING, SelectionType.TIERED)).toBe('/how-to-play?sport=horse-racing&format=TIERED');
  });

  it('opens How to Play on its way to play across every sport for a contest with no sport', () => {
    expect(buildHowToPlayFormatPath(null, SelectionType.PICK_EM)).toBe('/how-to-play?format=PICK_EM');
  });
});

describe('howToPlayFormatAnchor', () => {
  it('names a way to play\'s tile in lower case with dashes, so the link can scroll to it', () => {
    expect(howToPlayFormatAnchor(SelectionType.PICK_EM)).toBe('how-to-play-pick-em');
  });
});
