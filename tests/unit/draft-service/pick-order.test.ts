import {
  getRoundOrder,
  getPickPosition,
  generatePickSchedule,
  getEntryPickNumbers,
} from '../../../packages/draft-service/src/engine/pick-order';

describe('getRoundOrder', () => {
  it('returns ascending order for odd rounds', () => {
    expect(getRoundOrder(4, 1)).toEqual([0, 1, 2, 3]);
    expect(getRoundOrder(4, 3)).toEqual([0, 1, 2, 3]);
  });

  it('returns reversed order for even rounds', () => {
    expect(getRoundOrder(4, 2)).toEqual([3, 2, 1, 0]);
    expect(getRoundOrder(4, 4)).toEqual([3, 2, 1, 0]);
  });

  it('handles 2-team draft', () => {
    expect(getRoundOrder(2, 1)).toEqual([0, 1]);
    expect(getRoundOrder(2, 2)).toEqual([1, 0]);
  });
});

describe('getPickPosition', () => {
  describe('4-team draft', () => {
    it('pick 1 is round 1, entry 0', () => {
      const pos = getPickPosition(1, 4);
      expect(pos.round).toBe(1);
      expect(pos.pickInRound).toBe(1);
      expect(pos.entryIndex).toBe(0);
    });

    it('pick 4 is round 1, entry 3', () => {
      const pos = getPickPosition(4, 4);
      expect(pos.round).toBe(1);
      expect(pos.pickInRound).toBe(4);
      expect(pos.entryIndex).toBe(3);
    });

    it('pick 5 (round 2, snake reversal) is entry 3', () => {
      const pos = getPickPosition(5, 4);
      expect(pos.round).toBe(2);
      expect(pos.pickInRound).toBe(1);
      expect(pos.entryIndex).toBe(3);
    });

    it('pick 8 (round 2, last) is entry 0', () => {
      const pos = getPickPosition(8, 4);
      expect(pos.round).toBe(2);
      expect(pos.pickInRound).toBe(4);
      expect(pos.entryIndex).toBe(0);
    });

    it('pick 9 (round 3) snakes back to entry 0', () => {
      const pos = getPickPosition(9, 4);
      expect(pos.round).toBe(3);
      expect(pos.pickInRound).toBe(1);
      expect(pos.entryIndex).toBe(0);
    });
  });

  describe('12-team draft (standard)', () => {
    it('entry 0 gets picks 1 and 24 (snake back)', () => {
      const pick1 = getPickPosition(1, 12);
      expect(pick1.entryIndex).toBe(0);

      const pick24 = getPickPosition(24, 12);
      expect(pick24.round).toBe(2);
      expect(pick24.entryIndex).toBe(0);
    });

    it('entry 11 gets picks 12 and 13 (turn-around)', () => {
      const pick12 = getPickPosition(12, 12);
      expect(pick12.entryIndex).toBe(11);

      const pick13 = getPickPosition(13, 12);
      expect(pick13.entryIndex).toBe(11);
    });
  });
});

describe('generatePickSchedule', () => {
  it('generates correct total picks', () => {
    const schedule = generatePickSchedule(4, 3);
    expect(schedule).toHaveLength(12);
  });

  it('every entry gets equal picks', () => {
    const schedule = generatePickSchedule(6, 5);
    for (let i = 0; i < 6; i++) {
      const entryPicks = schedule.filter((p) => p.entryIndex === i);
      expect(entryPicks).toHaveLength(5);
    }
  });

  it('pick numbers are sequential', () => {
    const schedule = generatePickSchedule(3, 2);
    const pickNumbers = schedule.map((p) => p.pickNumber);
    expect(pickNumbers).toEqual([1, 2, 3, 4, 5, 6]);
  });
});

describe('getEntryPickNumbers', () => {
  it('returns correct picks for entry 0 in 4-team 3-round draft', () => {
    const picks = getEntryPickNumbers(0, 4, 3);
    expect(picks).toEqual([1, 8, 9]);
  });

  it('returns correct picks for entry 3 in 4-team 3-round draft', () => {
    const picks = getEntryPickNumbers(3, 4, 3);
    expect(picks).toEqual([4, 5, 12]);
  });
});
