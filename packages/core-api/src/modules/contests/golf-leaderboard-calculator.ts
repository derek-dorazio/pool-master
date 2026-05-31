import type {
  GolfLeaderboardEntryPickRow,
  GolfLeaderboardEntryRow,
  GolfLeaderboardParticipantRow,
  GolfLeaderboardRoundCellRow,
} from '../../mappers/contests.mapper';

export interface GolfLeaderboardCountingRule {
  type: 'BEST_N_GOLFERS';
  count: number;
}

export interface GolfContestConfigurationRow {
  configJson: unknown;
  rosterSize: number | null;
  pickCount: number | null;
  rounds: number | null;
}

export interface GolfLeaderboardEntryInput {
  id: string;
  entryNumber: number;
  name: string;
  status: string;
  squadId: string;
  squad: { name: string };
  picks: Array<{
    id: string;
    sportEventParticipantId: string;
    pickedAt: Date;
    slot: number | null;
    tier: string | null;
  }>;
}

export function resolveGolfLeaderboardCountingRule(
  configuration: GolfContestConfigurationRow | null,
): GolfLeaderboardCountingRule | null {
  const configJson = configuration?.configJson;
  const configRecord =
    configJson && typeof configJson === 'object' && !Array.isArray(configJson)
      ? configJson as Record<string, unknown>
      : null;
  const countedScores = readPositiveInteger(configRecord?.countedScores)
    ?? readPositiveInteger(configuration?.rosterSize)
    ?? readPositiveInteger(configuration?.pickCount);

  if (!countedScores) {
    return null;
  }

  return {
    type: 'BEST_N_GOLFERS',
    count: countedScores,
  };
}

export function buildGolfLeaderboardEntry(
  entry: GolfLeaderboardEntryInput,
  participantById: Map<string, GolfLeaderboardParticipantRow>,
  countingRule: GolfLeaderboardCountingRule,
): GolfLeaderboardEntryRow {
  const scoredPicks = entry.picks
    .map((pick) => ({
      pick,
      participant: participantById.get(pick.sportEventParticipantId) ?? null,
    }))
    .filter((row): row is {
      pick: GolfLeaderboardEntryInput['picks'][number];
      participant: GolfLeaderboardParticipantRow;
    } => row.participant !== null && row.participant.totalScoreToPar !== null)
    .sort((left, right) =>
      compareGolfScores(
        left.participant.totalScoreToPar,
        right.participant.totalScoreToPar,
      )
      || left.participant.name.localeCompare(right.participant.name)
      || left.pick.id.localeCompare(right.pick.id),
    );
  const countingPickIds = new Set(
    scoredPicks.slice(0, countingRule.count).map((row) => row.pick.id),
  );
  const picks: GolfLeaderboardEntryPickRow[] = entry.picks
    .map((pick) => {
      const participant = participantById.get(pick.sportEventParticipantId);
      if (!participant) {
        return null;
      }
      const hasScore = participant.totalScoreToPar !== null;
      const isCounting = countingPickIds.has(pick.id);
      return {
        pickId: pick.id,
        sportEventParticipantId: pick.sportEventParticipantId,
        pickedAt: pick.pickedAt,
        slot: pick.slot,
        tier: pick.tier,
        isCounting,
        isDropped: hasScore && !isCounting,
        participant,
      };
    })
    .filter((pick): pick is GolfLeaderboardEntryPickRow => pick !== null)
    .sort(compareGolfLeaderboardEntryPicks);
  const countingScores: number[] = [];
  for (const pick of picks) {
    if (pick.isCounting && pick.participant.totalScoreToPar !== null) {
      countingScores.push(pick.participant.totalScoreToPar);
    }
  }

  return {
    entryId: entry.id,
    entryName: entry.name,
    entryNumber: entry.entryNumber,
    squadId: entry.squadId,
    squadName: entry.squad.name,
    status: entry.status === 'INACTIVE' ? 'INACTIVE' : 'ACTIVE',
    totalScoreToPar: countingScores.length > 0
      ? countingScores.reduce((sum, score) => sum + score, 0)
      : null,
    position: null,
    displayPosition: null,
    countingPickCount: countingRule.count,
    scoredPickCount: scoredPicks.length,
    picks,
  };
}

export function rankGolfLeaderboardEntries(entries: GolfLeaderboardEntryRow[]): GolfLeaderboardEntryRow[] {
  const sorted = [...entries].sort((left, right) =>
    compareGolfScores(left.totalScoreToPar, right.totalScoreToPar)
    || left.entryNumber - right.entryNumber
    || left.entryName.localeCompare(right.entryName)
    || left.entryId.localeCompare(right.entryId),
  );
  const scoreCounts = new Map<number, number>();
  for (const entry of sorted) {
    if (entry.totalScoreToPar !== null) {
      scoreCounts.set(entry.totalScoreToPar, (scoreCounts.get(entry.totalScoreToPar) ?? 0) + 1);
    }
  }

  let lastScore: number | null = null;
  let lastPosition = 0;
  return sorted.map((entry, index) => {
    if (entry.totalScoreToPar === null) {
      return {
        ...entry,
        position: null,
        displayPosition: null,
      };
    }
    if (lastScore === null || entry.totalScoreToPar !== lastScore) {
      lastScore = entry.totalScoreToPar;
      lastPosition = index + 1;
    }
    const tieCount = scoreCounts.get(entry.totalScoreToPar) ?? 1;
    return {
      ...entry,
      position: lastPosition,
      displayPosition: tieCount > 1 ? `T${lastPosition}` : String(lastPosition),
    };
  });
}

export function buildGolfRoundColumns(
  rounds: Array<{
    round: number;
    strokes: number;
    scoreToPar: number;
    thru: number | null;
    status: string;
  }>,
): GolfLeaderboardParticipantRow['rounds'] {
  const columns: GolfLeaderboardParticipantRow['rounds'] = {
    r1: null,
    r2: null,
    r3: null,
    r4: null,
  };
  for (const round of rounds) {
    if (round.round < 1 || round.round > 4) {
      continue;
    }
    const cell = toGolfRoundCell(round);
    columns[`r${round.round}` as keyof GolfLeaderboardParticipantRow['rounds']] = cell;
  }
  return columns;
}

export function mapGolfLeaderboardStatus(status: string): GolfLeaderboardParticipantRow['status'] {
  switch (status) {
    case 'IN_PROGRESS':
    case 'in-progress':
      return 'in-progress';
    case 'COMPLETE':
    case 'COMPLETED':
    case 'complete':
      return 'complete';
    case 'WITHDRAWN':
    case 'DNF':
    case 'DSQ':
    case 'withdrawn':
      return 'withdrawn';
    case 'MISSED_CUT':
    case 'missed-cut':
      return 'missed-cut';
    case 'ACTIVE':
    case 'PENDING':
    case 'active':
    default:
      return 'active';
  }
}

export function compareGolfScores(left: number | null, right: number | null): number {
  if (left === null && right === null) return 0;
  if (left === null) return 1;
  if (right === null) return -1;
  return left - right;
}

export function formatRelativeToPar(value: number): string {
  if (value > 0) return `+${value}`;
  return String(value);
}

function compareGolfLeaderboardEntryPicks(
  left: GolfLeaderboardEntryPickRow,
  right: GolfLeaderboardEntryPickRow,
): number {
  const leftScore = left.participant.totalScoreToPar;
  const rightScore = right.participant.totalScoreToPar;
  if (leftScore !== null && rightScore !== null) {
    return compareGolfScores(leftScore, rightScore)
      || left.participant.name.localeCompare(right.participant.name)
      || left.pickId.localeCompare(right.pickId);
  }
  if (leftScore !== null) return -1;
  if (rightScore !== null) return 1;

  return compareGolfScores(left.slot, right.slot)
    || left.pickedAt.getTime() - right.pickedAt.getTime()
    || left.pickId.localeCompare(right.pickId);
}

function toGolfRoundCell(round: {
  round: number;
  strokes: number;
  scoreToPar: number;
  thru: number | null;
  status: string;
}): GolfLeaderboardRoundCellRow {
  const status = mapGolfLeaderboardStatus(round.status);
  const isComplete = status === 'complete';
  const displayType = isComplete ? 'STROKES' : 'TO_PAR';
  return {
    round: round.round as 1 | 2 | 3 | 4,
    status,
    strokes: round.strokes,
    scoreToPar: round.scoreToPar,
    thru: status === 'in-progress' ? round.thru ?? null : null,
    displayType,
    displayValue: isComplete ? String(round.strokes) : formatRelativeToPar(round.scoreToPar),
  };
}

function readPositiveInteger(value: unknown): number | null {
  if (typeof value !== 'number' || !Number.isInteger(value) || value <= 0) {
    return null;
  }
  return value;
}
