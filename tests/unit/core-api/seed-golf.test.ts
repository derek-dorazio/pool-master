import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  golferRoundScore,
  seedDateOffsetDays,
  shiftedEventDates,
  type GolfSeedFile,
} from '../../../packages/core-api/scripts/seed-golf/seed-golf-data';

function seedWithStarts(...startDates: string[]): GolfSeedFile {
  return {
    season: 2026,
    notes: '',
    tours: [{
      name: 'Tour',
      players: [],
      events: startDates.map((startDate, index) => ({
        key: `e${index}`,
        name: `Event ${index}`,
        startDate,
        endDate: startDate,
        venue: null,
        location: null,
        rounds: 4,
        roundsPar: 72,
        winner: 'generated',
        field: [],
      })),
    }],
  };
}

describe('golf seed dates', () => {
  it('moves the season forward by whole weeks so its first event starts at least a week after the run', () => {
    // 2026-01-15 is a Thursday; a run on 2026-10-08 needs 280 days to clear 2026-10-15.
    const offset = seedDateOffsetDays(seedWithStarts('2026-03-05', '2026-01-15'), new Date('2026-10-08T19:00:00Z'));

    expect(offset % 7).toBe(0);
    expect(offset).toBe(280);
    expect(shiftedEventDates({ startDate: '2026-01-15', endDate: '2026-01-18' }, offset)).toEqual({
      startDate: '2026-10-22T12:00:00.000Z',
      endDate: '2026-10-25T23:00:00.000Z',
    });
  });

  it('leaves the dates alone when the season is already more than a week away', () => {
    expect(seedDateOffsetDays(seedWithStarts('2026-01-15'), new Date('2025-12-01T00:00:00Z'))).toBe(0);
  });
});

describe('golf seed round scores', () => {
  const golfer = { player: 'p', ranking: 1, oddsToWin: 5, rounds: [70, 75] };

  it('stores a finished round as completed, eighteen holes, to par against the event par', () => {
    expect(golferRoundScore(golfer, 1, 72)).toEqual({ strokes: 70, scoreToPar: -2, thru: 18, status: 'COMPLETED' });
  });

  it('marks the last round of a golfer who missed the cut as MISSED_CUT and stores nothing after it', () => {
    const cut = { ...golfer, finish: 'MC' as const };

    expect(golferRoundScore(cut, 2, 72)).toEqual({ strokes: 75, scoreToPar: 3, thru: 18, status: 'MISSED_CUT' });
    expect(golferRoundScore(cut, 3, 72)).toBeNull();
  });

  it('stores a withdrawal as a DNF round through the holes played, to par for those holes', () => {
    const withdrawn = { ...golfer, rounds: [70, 40], finish: 'WD' as const, withdrawnThru: 9 };

    expect(golferRoundScore(withdrawn, 2, 72)).toEqual({ strokes: 40, scoreToPar: 4, thru: 9, status: 'DNF' });
  });
});

describe('golf-2026.json', () => {
  const seed = JSON.parse(readFileSync(join(__dirname, '../../../packages/core-api/scripts/seed-golf/golf-2026.json'), 'utf8')) as GolfSeedFile;

  it('holds every 2026 PGA TOUR and LPGA Tour event, each field drawn from its own tour', () => {
    expect(seed.tours.map((tour) => [tour.name, tour.events.length])).toEqual([['PGA TOUR', 45], ['LPGA Tour', 31]]);
    for (const tour of seed.tours) {
      const keys = new Set(tour.players.map((player) => player.key));
      for (const event of tour.events) {
        expect(event.field.length).toBeGreaterThan(60);
        expect(event.field.every((golfer) => keys.has(golfer.player))).toBe(true);
        expect(new Set(event.field.map((golfer) => golfer.player)).size).toBe(event.field.length);
      }
    }
  });

  it('gives each event one outright winner and a full set of rounds to everyone who finished', () => {
    for (const event of seed.tours.flatMap((tour) => tour.events)) {
      const finishers = event.field.filter((golfer) => !golfer.finish);
      expect(finishers.every((golfer) => golfer.rounds.length === event.rounds)).toBe(true);
      const totals = finishers.map((golfer) => golfer.rounds.reduce((sum, strokes) => sum + strokes, 0)).sort((a, b) => a - b);
      if (event.winner === 'public') expect(totals[0]).toBeLessThan(totals[1]);
    }
  });
});
