import {
  Sport,
  ContestStatus,
  ContestFormat,
  TournamentFormat,
  SelectionType,
  ScoringEngine,
  SurvivorStyle,
  DraftMode,
  PricingMethod,
  TierAssignmentMethod,
  VALID_CONTEST_FORMATS_BY_TOURNAMENT_FORMAT,
  getDefaultTournamentFormatForSport,
  getValidContestFormatsForTournamentFormat,
  isContestFormatValidForSport,
} from '@poolmaster/shared/domain';

describe('Sport enum', () => {
  it('has core US sports', () => {
    expect(Sport.GOLF).toBe('GOLF');
    expect(Sport.NFL).toBe('NFL');
    expect(Sport.NBA).toBe('NBA');
    expect(Sport.NHL).toBe('NHL');
    expect(Sport.MLB).toBe('MLB');
    expect(Sport.NCAA_BASKETBALL).toBe('NCAA_BASKETBALL');
    expect(Sport.NCAA_FOOTBALL).toBe('NCAA_FOOTBALL');
    expect(Sport.NASCAR).toBe('NASCAR');
  });

  it('has international sports', () => {
    expect(Sport.SOCCER).toBe('SOCCER');
    expect(Sport.TENNIS).toBe('TENNIS');
    expect(Sport.F1).toBe('F1');
    expect(Sport.HORSE_RACING).toBe('HORSE_RACING');
    expect(Sport.UFC).toBe('UFC');
  });
});

describe('SelectionType enum', () => {
  it('has squad selection types', () => {
    expect(SelectionType.SNAKE_DRAFT).toBe('SNAKE_DRAFT');
    expect(SelectionType.TIERED).toBe('TIERED');
    expect(SelectionType.BUDGET_PICK).toBe('BUDGET_PICK');
    expect(SelectionType.OPEN_SELECTION).toBe('OPEN_SELECTION');
  });

  it('has prediction types', () => {
    expect(SelectionType.PICK_EM).toBe('PICK_EM');
    expect(SelectionType.BRACKET_PICK_EM).toBe('BRACKET_PICK_EM');
  });
});

describe('ScoringEngine enum', () => {
  it('has all scoring engines from contest structures', () => {
    expect(ScoringEngine.ADVANCEMENT).toBe('ADVANCEMENT');
    expect(ScoringEngine.STAT_ACCUMULATION).toBe('STAT_ACCUMULATION');
    expect(ScoringEngine.STROKE_PLAY).toBe('STROKE_PLAY');
    expect(ScoringEngine.POSITION).toBe('POSITION');
    expect(ScoringEngine.BRACKET).toBe('BRACKET');
    expect(ScoringEngine.FIGHT_RESULT).toBe('FIGHT_RESULT');
    expect(ScoringEngine.CUMULATIVE).toBe('CUMULATIVE');
  });
});

describe('SurvivorStyle enum', () => {
  it('has both pick styles', () => {
    expect(SurvivorStyle.LIVE_PICK).toBe('LIVE_PICK');
    expect(SurvivorStyle.LOCKED_PICK).toBe('LOCKED_PICK');
  });
});

describe('ContestFormat enum', () => {
  it('has single-event', () => {
    expect(ContestFormat.ROSTER).toBe('ROSTER');
  });
});

describe('Contest validity matrix', () => {
  it('pool-master-rop.78.14 covers every tournament format with a typed contest-format list', () => {
    expect(
      Object.keys(VALID_CONTEST_FORMATS_BY_TOURNAMENT_FORMAT).sort(),
    ).toEqual(Object.values(TournamentFormat).sort());
  });

  it('pool-master-rop.78.14 maps tournament structures to their valid contest formats', () => {
    expect(
      getValidContestFormatsForTournamentFormat(
        TournamentFormat.STROKE_PLAY_TOURNAMENT,
      ),
    ).toEqual([ContestFormat.ROSTER]);
    expect(
      getValidContestFormatsForTournamentFormat(
        TournamentFormat.KNOCKOUT_BRACKET,
      ),
    ).toEqual([ContestFormat.ROSTER, ContestFormat.BRACKET]);
    expect(
      getValidContestFormatsForTournamentFormat(
        TournamentFormat.WEEKLY_GAMES_SEASON,
      ),
    ).toEqual([ContestFormat.PICKEM_CONFIDENCE, ContestFormat.SURVIVOR]);
  });

  it('pool-master-rop.78.14 derives sport defaults before validating contest format choices', () => {
    expect(getDefaultTournamentFormatForSport(Sport.GOLF)).toBe(
      TournamentFormat.STROKE_PLAY_TOURNAMENT,
    );
    expect(isContestFormatValidForSport(Sport.GOLF, ContestFormat.ROSTER)).toBe(
      true,
    );
    expect(isContestFormatValidForSport(Sport.GOLF, ContestFormat.BRACKET)).toBe(
      false,
    );
  });
});

describe('ContestStatus enum', () => {
  it('has full lifecycle', () => {
    expect(ContestStatus.DRAFT).toBe('DRAFT');
    expect(ContestStatus.OPEN).toBe('OPEN');
    expect(ContestStatus.DRAFTING).toBe('DRAFTING');
    expect(ContestStatus.LOCKED).toBe('LOCKED');
    expect(ContestStatus.ACTIVE).toBe('ACTIVE');
    expect(ContestStatus.COMPLETED).toBe('COMPLETED');
    expect(ContestStatus.CANCELLED).toBe('CANCELLED');
  });
});

describe('DraftMode enum', () => {
  it('has live and async', () => {
    expect(DraftMode.LIVE).toBe('LIVE');
    expect(DraftMode.ASYNC).toBe('ASYNC');
  });
});

describe('PricingMethod enum', () => {
  it('has all pricing methods for budget/tiered contests', () => {
    expect(PricingMethod.ODDS).toBe('ODDS');
    expect(PricingMethod.SEED).toBe('SEED');
    expect(PricingMethod.WORLD_RANKING).toBe('WORLD_RANKING');
    expect(PricingMethod.SEASON_STATS).toBe('SEASON_STATS');
    expect(PricingMethod.COMMISSIONER).toBe('COMMISSIONER');
  });
});

describe('TierAssignmentMethod enum', () => {
  it('has all tier assignment methods', () => {
    expect(TierAssignmentMethod.SEED).toBe('SEED');
    expect(TierAssignmentMethod.WORLD_RANKING).toBe('WORLD_RANKING');
    expect(TierAssignmentMethod.ODDS).toBe('ODDS');
    expect(TierAssignmentMethod.COMMISSIONER).toBe('COMMISSIONER');
    expect(TierAssignmentMethod.CONFERENCE).toBe('CONFERENCE');
    expect(TierAssignmentMethod.BOUT_POSITION).toBe('BOUT_POSITION');
  });
});
