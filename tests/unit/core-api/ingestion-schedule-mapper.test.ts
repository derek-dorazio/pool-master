import { toIngestionScheduleDto } from '../../../packages/core-api/src/mappers/ingestion-schedule.mapper';

describe('toIngestionScheduleDto', () => {
  it('says a sync with a switch runs only while it is on, and a sync with none (the field sync) always runs and has no switch', () => {
    const read = toIngestionScheduleDto({
      EVENTS: { enabled: false, intervalMinutes: 360 },
      FIELD: { intervalMinutes: 360, lookaheadDays: 14 },
      SCORES: { enabled: true, intervalSeconds: 300 },
    });

    expect(read).toEqual({
      EVENTS: { enabled: false, intervalMinutes: 360, runs: false, switchable: true },
      FIELD: { intervalMinutes: 360, lookaheadDays: 14, runs: true, switchable: false },
      SCORES: { enabled: true, intervalSeconds: 300, runs: true, switchable: true },
    });
  });
});
