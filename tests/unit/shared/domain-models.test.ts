import {
  Sport,
  ContestStatus,
  ContestType,
  DraftType,
  DraftMode,
  LeagueVisibility,
  ScoringType,
} from '@poolmaster/shared/domain';

describe('Sport enum', () => {
  it('has expected values', () => {
    expect(Sport.GOLF).toBe('GOLF');
    expect(Sport.NFL).toBe('NFL');
    expect(Sport.F1).toBe('F1');
  });
});

describe('ContestStatus enum', () => {
  it('has expected values', () => {
    expect(ContestStatus.DRAFT).toBe('DRAFT');
    expect(ContestStatus.ACTIVE).toBe('ACTIVE');
    expect(ContestStatus.COMPLETED).toBe('COMPLETED');
  });
});

describe('ContestType enum', () => {
  it('has expected values', () => {
    expect(ContestType.SINGLE_EVENT).toBe('SINGLE_EVENT');
    expect(ContestType.SEASON_LONG).toBe('SEASON_LONG');
    expect(ContestType.BRACKET).toBe('BRACKET');
  });
});

describe('DraftType enum', () => {
  it('has expected values', () => {
    expect(DraftType.SNAKE).toBe('SNAKE');
    expect(DraftType.SALARY_CAP).toBe('SALARY_CAP');
    expect(DraftType.TIERED).toBe('TIERED');
  });
});

describe('DraftMode enum', () => {
  it('has expected values', () => {
    expect(DraftMode.LIVE).toBe('LIVE');
    expect(DraftMode.ASYNC).toBe('ASYNC');
  });
});

describe('ScoringType enum', () => {
  it('has all expected scoring types', () => {
    expect(ScoringType.CUMULATIVE).toBe('CUMULATIVE');
    expect(ScoringType.BRACKET).toBe('BRACKET');
    expect(ScoringType.STROKE_PLAY).toBe('STROKE_PLAY');
    expect(ScoringType.POSITION).toBe('POSITION');
  });
});

describe('LeagueVisibility enum', () => {
  it('has expected values', () => {
    expect(LeagueVisibility.PRIVATE).toBe('PRIVATE');
    expect(LeagueVisibility.PUBLIC).toBe('PUBLIC');
  });
});
