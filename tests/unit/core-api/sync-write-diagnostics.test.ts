import {
  mergeSyncWriteDiagnostics,
  summarizeSyncWriteRows,
  syncWriteStats,
  type SyncWriteDisposition,
} from '../../../packages/core-api/src/modules/ingestion/core/sync-write-diagnostics';

// What a sync wrote, summed by what happened to each row, for the sync run's log and stats.

const row = (id: string, disposition: SyncWriteDisposition) => ({ id, entityType: 'SportEventParticipant', disposition });

describe('sync write diagnostics', () => {
  it('counts each row under what happened to it, and merges several syncs while skipping one that wrote nothing', () => {
    const first = summarizeSyncWriteRows([row('a', 'CREATED'), row('b', 'UNCHANGED')]);
    const second = summarizeSyncWriteRows([row('c', 'UPDATED'), row('d', 'DELETED'), row('e', 'DELETED')]);

    const merged = mergeSyncWriteDiagnostics([first, undefined, second]);

    expect(merged.summary).toEqual({ total: 5, unchanged: 1, created: 1, updated: 1, deleted: 2 });
    expect(merged.rows.map((each) => each.id)).toEqual(['a', 'b', 'c', 'd', 'e']);
    expect(syncWriteStats(merged)).toEqual({ writeRows: 5, writeUnchanged: 1, writeCreated: 1, writeUpdated: 1, writeDeleted: 2 });
  });

  it('reports no stats for a sync with no diagnostics', () => {
    expect(syncWriteStats(undefined)).toEqual({});
  });
});
