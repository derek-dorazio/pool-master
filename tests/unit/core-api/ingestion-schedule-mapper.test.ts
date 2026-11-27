import { toIngestionScheduleDto } from '../../../packages/core-api/src/mappers/ingestion-schedule.mapper';

const intervals = (inSeason: Record<string, number>, offseason: Record<string, number>) => ({ IN_SEASON: inSeason, OFFSEASON: offseason });

describe('toIngestionScheduleDto', () => {
  it('says a sync with a switch runs only while it is on, and a sync with none (the field sync) always runs and has no switch, each with its intervals per Season state', () => {
    const read = toIngestionScheduleDto({
      EVENTS: { enabled: false, intervals: intervals({ intervalMinutes: 360 }, { intervalMinutes: 1440 }) },
      FIELD: { intervals: intervals({ intervalMinutes: 360 }, { intervalMinutes: 1440 }) },
      SCORES: { enabled: true, intervals: intervals({ intervalSeconds: 300 }, { intervalSeconds: 300 }) },
    });

    expect(read).toEqual({
      EVENTS: { enabled: false, intervals: intervals({ intervalMinutes: 360 }, { intervalMinutes: 1440 }), runs: false, switchable: true },
      FIELD: { intervals: intervals({ intervalMinutes: 360 }, { intervalMinutes: 1440 }), runs: true, switchable: false },
      SCORES: { enabled: true, intervals: intervals({ intervalSeconds: 300 }, { intervalSeconds: 300 }), runs: true, switchable: true },
    });
  });
});
