import {
  Sport,
  ContestStatus,
  ContestFormat,
  TournamentFormat,
  VALID_CONTEST_FORMATS_BY_TOURNAMENT_FORMAT,
  ParticipantInactiveReason,
  deriveLegacyParticipantStatus,
  formatParticipantStatusLabel,
  getDefaultTournamentFormatForSport,
  getValidContestFormatsForTournamentFormat,
  isContestFormatValidForSport,
} from '@poolmaster/shared/domain';

describe('Contest validity matrix', () => {
  it('pool-master-rop.78.14 covers every tournament format with a typed contest-format list', () => {
    expect(
      Object.keys(VALID_CONTEST_FORMATS_BY_TOURNAMENT_FORMAT).sort(),
    ).toEqual(Object.values(TournamentFormat).sort());
  });

  it('allows roster contests on a stroke-play tournament', () => {
    expect(
      getValidContestFormatsForTournamentFormat(
        TournamentFormat.STROKE_PLAY_TOURNAMENT,
      ),
    ).toEqual([ContestFormat.ROSTER]);
  });

  it('pool-master-rop.78.14 derives sport defaults before validating contest format choices', () => {
    expect(getDefaultTournamentFormatForSport(Sport.GOLF)).toBe(
      TournamentFormat.STROKE_PLAY_TOURNAMENT,
    );
    expect(isContestFormatValidForSport(Sport.GOLF, ContestFormat.ROSTER)).toBe(
      true,
    );
  });
});

describe('ContestStatus enum', () => {
  it('has full lifecycle', () => {
    expect(ContestStatus.DRAFT).toBe('DRAFT');
    expect(ContestStatus.OPEN).toBe('OPEN');
    expect(ContestStatus.ACTIVE).toBe('ACTIVE');
    expect(ContestStatus.COMPLETED).toBe('COMPLETED');
  });
});

// pool-master-uvc — single source of truth consumed by admin-events.mapper.ts,
// selections/routes.ts, and contests/service.ts (x2); each call site's own test
// asserts it's wired to this function (see mock spy assertions there) rather
// than re-testing every branch redundantly.
describe('deriveLegacyParticipantStatus', () => {
  it('pool-master-uvc: returns ACTIVE when isActive is true, regardless of inactiveReason', () => {
    expect(deriveLegacyParticipantStatus(true, null)).toBe('ACTIVE');
    expect(deriveLegacyParticipantStatus(true, undefined)).toBe('ACTIVE');
    expect(deriveLegacyParticipantStatus(true, ParticipantInactiveReason.WITHDRAWN)).toBe('ACTIVE');
  });

  it('pool-master-uvc: returns the inactiveReason when isActive is false and a reason is recorded', () => {
    expect(deriveLegacyParticipantStatus(false, ParticipantInactiveReason.WITHDRAWN)).toBe('WITHDRAWN');
    expect(deriveLegacyParticipantStatus(false, ParticipantInactiveReason.ELIMINATED)).toBe('ELIMINATED');
  });

  it('pool-master-uvc: falls back to INACTIVE when isActive is false and no reason is recorded', () => {
    expect(deriveLegacyParticipantStatus(false, null)).toBe('INACTIVE');
    expect(deriveLegacyParticipantStatus(false, undefined)).toBe('INACTIVE');
  });
});

describe('formatParticipantStatusLabel', () => {
  it('reads ELIMINATED in the sport\'s own word (Cut for golf); with no sport, and for every other status, reads in title case', () => {
    expect(formatParticipantStatusLabel('ELIMINATED', 'GOLF')).toBe('Cut');
    expect(formatParticipantStatusLabel('ELIMINATED', null)).toBe('Eliminated');
    expect(formatParticipantStatusLabel('WITHDRAWN', 'GOLF')).toBe('Withdrawn');
    expect(formatParticipantStatusLabel('IN_PROGRESS', 'GOLF')).toBe('In Progress');
  });

  it('reads a withdrawn horse as Scratched, and ELIMINATED generically for horse racing, which has no word for it', () => {
    expect(formatParticipantStatusLabel('WITHDRAWN', 'HORSE_RACING')).toBe('Scratched');
    expect(formatParticipantStatusLabel('ELIMINATED', 'HORSE_RACING')).toBe('Eliminated');
    expect(formatParticipantStatusLabel('WITHDRAWN', null)).toBe('Withdrawn');
  });
});
