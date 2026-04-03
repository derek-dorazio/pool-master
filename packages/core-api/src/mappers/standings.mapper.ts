import type {
  MyEntryResult,
  StandingEntry,
  StandingsPage,
  StandingsSummary,
} from '../modules/standings/service';

function mapStandingEntryToDto(entry: StandingEntry) {
  return {
    rank: entry.rank,
    entryId: entry.entryId,
    entryName: entry.entryName,
    ownerDisplayName: entry.ownerDisplayName,
    ownerId: entry.ownerId,
    totalScore: entry.totalScore,
    previousRank: entry.previousRank,
    movement: entry.movement,
    isEliminated: entry.isEliminated,
    lastUpdatedAt: entry.lastUpdatedAt.toISOString(),
  };
}

export function mapStandingsPageToDto(page: StandingsPage) {
  return {
    standings: page.standings.map(mapStandingEntryToDto),
    total: page.total,
    page: page.page,
    pageSize: page.pageSize,
    contestId: page.contestId,
  };
}

export function mapStandingsSummaryToDto(summary: StandingsSummary) {
  return {
    topEntries: summary.topEntries.map(mapStandingEntryToDto),
    totalEntries: summary.totalEntries,
    contestId: summary.contestId,
  };
}

export function mapMyEntryResultToDto(result: MyEntryResult) {
  return {
    entry: mapStandingEntryToDto(result.entry),
    totalEntries: result.totalEntries,
    contestId: result.contestId,
  };
}
