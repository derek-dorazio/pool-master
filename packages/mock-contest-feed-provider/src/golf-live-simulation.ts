import type {
  ContestantRecord,
  LiveGolfContestantRecord,
  LiveGolfRoundRecord,
  LiveGolfRoundStatusKind,
  ParticipantStatusKind,
} from './contracts';

// A deterministic, time-driven golf tournament (#382). Given a field and a point on the
// event's timeline it returns every golfer's rounds as a live feed would at that moment:
// staggered tee times, hole-by-hole scoring tilted by ranking, a 36-hole cut, and the odd
// withdrawal. The same inputs always give the same scores. Golf has four rounds and 18 holes;
// nothing here ever produces a round 5 or a hole past 18 (#118, #375).

const holePars = [4, 4, 3, 5, 4, 4, 3, 4, 5, 4, 4, 3, 5, 4, 4, 3, 4, 5] as const;
const holesPerRound = holePars.length;
const roundsPerEvent = 4;
const cutRound = 2;
const cutSize = 65;
const teeWindowShare = 1 / 3;
const playShare = 2 / 3;
const withdrawalRate = 0.02;
const minuteMs = 60 * 1000;

export interface GolfLiveTimeline {
  readonly startsAt: Date;
  readonly minutesPerRound: number;
  readonly minutesBetweenRounds: number;
}

export type GolfLiveTimelinePhase = 'scheduled' | 'in_progress' | 'completed';

export function hashUnit(seed: string): number {
  let hash = 2166136261;
  for (let index = 0; index < seed.length; index += 1) {
    hash ^= seed.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }

  return (hash >>> 0) / 4294967295;
}

/**
 * `hashUnit` plus a murmur3 finaliser. FNV alone barely changes its high bits when only the
 * last characters of the seed differ (hole 1 vs hole 2), which made neighbouring holes
 * correlated; the finaliser spreads every input bit across the output.
 */
function drawUnit(seed: string): number {
  let hash = Math.round(hashUnit(seed) * 4294967295) >>> 0;
  hash ^= hash >>> 16;
  hash = Math.imul(hash, 0x85ebca6b);
  hash ^= hash >>> 13;
  hash = Math.imul(hash, 0xc2b2ae35);
  hash ^= hash >>> 16;
  return (hash >>> 0) / 4294967296;
}

function roundStartMs(timeline: GolfLiveTimeline, round: number): number {
  return timeline.startsAt.getTime()
    + (round - 1) * (timeline.minutesPerRound + timeline.minutesBetweenRounds) * minuteMs;
}

export function golfLiveTimelineEndsAt(timeline: GolfLiveTimeline): Date {
  return new Date(roundStartMs(timeline, roundsPerEvent) + timeline.minutesPerRound * minuteMs);
}

export function golfLiveTimelinePosition(
  timeline: GolfLiveTimeline,
  now: Date,
): { readonly phase: GolfLiveTimelinePhase; readonly currentRound: number | null } {
  const time = now.getTime();
  if (time < timeline.startsAt.getTime()) {
    return { phase: 'scheduled', currentRound: null };
  }
  if (time >= golfLiveTimelineEndsAt(timeline).getTime()) {
    return { phase: 'completed', currentRound: null };
  }

  let currentRound = 1;
  for (let round = 2; round <= roundsPerEvent; round += 1) {
    if (time >= roundStartMs(timeline, round)) currentRound = round;
  }
  return { phase: 'in_progress', currentRound };
}

/** Per-hole outcome odds; `strength` is 1 for the best-ranked golfer and 0 for the worst. */
function holeScoreDelta(strength: number, draw: number): number {
  const eagle = 0.005 + 0.01 * strength;
  const birdie = 0.15 + 0.1 * strength;
  const bogey = 0.17 - 0.07 * strength;
  const double = 0.03 - 0.015 * strength;
  if (draw < eagle) return -2;
  if (draw < eagle + birdie) return -1;
  if (draw < eagle + birdie + bogey) return 1;
  if (draw < eagle + birdie + bogey + double) return 2;
  return 0;
}

interface SimulatedGolfer {
  readonly contestant: ContestantRecord;
  readonly strength: number;
  readonly withdrawal: { readonly round: number; readonly afterHole: number } | null;
  readonly rounds: LiveGolfRoundRecord[];
  active: boolean;
}

function totalToPar(golfer: SimulatedGolfer): number {
  return golfer.rounds.reduce((sum, round) => sum + round.scoreToPar, 0);
}

function buildGolfers(eventSeed: string, contestants: readonly ContestantRecord[]): SimulatedGolfer[] {
  const byRank = contestants
    .map((contestant, index) => ({ contestant, index }))
    .sort((left, right) => {
      const leftSeed = left.contestant.seed ?? Number.POSITIVE_INFINITY;
      const rightSeed = right.contestant.seed ?? Number.POSITIVE_INFINITY;
      return leftSeed - rightSeed || left.index - right.index;
    });
  const lastRank = Math.max(1, byRank.length - 1);

  return byRank.map(({ contestant }, rank) => {
    const id = contestant.contestantId;
    const withdraws = drawUnit(`${eventSeed}:${id}:wd`) < withdrawalRate;
    return {
      contestant,
      strength: byRank.length === 1 ? 1 : (lastRank - rank) / lastRank,
      withdrawal: withdraws
        ? {
          round: 1 + Math.floor(drawUnit(`${eventSeed}:${id}:wd-round`) * roundsPerEvent),
          afterHole: 1 + Math.floor(drawUnit(`${eventSeed}:${id}:wd-hole`) * (holesPerRound - 1)),
        }
        : null,
      rounds: [],
      active: true,
    };
  });
}

/**
 * Rounds 1 and 2 go off in a seeded random order; from round 3 the leaders tee off last, as
 * they do on tour.
 */
function teeOrder(eventSeed: string, round: number, golfers: readonly SimulatedGolfer[]): SimulatedGolfer[] {
  const tieBreak = (golfer: SimulatedGolfer) => drawUnit(`${eventSeed}:${golfer.contestant.contestantId}:tee:${round}`);
  return [...golfers].sort((left, right) => (
    round > cutRound
      ? totalToPar(right) - totalToPar(left) || tieBreak(left) - tieBreak(right)
      : tieBreak(left) - tieBreak(right)
  ));
}

function playRound(input: {
  readonly eventSeed: string;
  readonly golfer: SimulatedGolfer;
  readonly round: number;
  readonly teeMs: number;
  readonly holeMs: number;
  readonly nowMs: number;
}): LiveGolfRoundRecord | null {
  const { eventSeed, golfer, round, teeMs, holeMs, nowMs } = input;
  // A golfer appears on the board once they have finished their first hole of the round.
  if (nowMs < teeMs + holeMs) {
    return null;
  }

  const holesByClock = Math.min(holesPerRound, Math.floor((nowMs - teeMs) / holeMs));
  const withdrawsThisRound = golfer.withdrawal?.round === round;
  const lastHole = withdrawsThisRound ? golfer.withdrawal.afterHole : holesPerRound;
  const thru = Math.min(holesByClock, lastHole);

  let strokes = 0;
  let scoreToPar = 0;
  for (let hole = 1; hole <= thru; hole += 1) {
    const delta = holeScoreDelta(
      golfer.strength,
      drawUnit(`${eventSeed}:${golfer.contestant.contestantId}:round:${round}:hole:${hole}`),
    );
    strokes += holePars[hole - 1] + delta;
    scoreToPar += delta;
  }

  const finished = thru === lastHole;
  const status: LiveGolfRoundStatusKind = !finished ? 'IN_PROGRESS' : withdrawsThisRound ? 'DNF' : 'COMPLETED';
  return {
    round,
    strokes,
    scoreToPar,
    thru,
    status,
    ...(finished ? { completedAt: new Date(teeMs + lastHole * holeMs).toISOString() } : {}),
  };
}

/** Top 65 and ties after round 2 play the weekend; everyone else's round 2 becomes MISSED_CUT. */
function applyCut(golfers: readonly SimulatedGolfer[]): void {
  const contenders = golfers
    .filter((golfer) => golfer.active)
    .sort((left, right) => totalToPar(left) - totalToPar(right));
  if (contenders.length <= cutSize) {
    return;
  }

  const cutLine = totalToPar(contenders[cutSize - 1]);
  for (const golfer of contenders) {
    if (totalToPar(golfer) > cutLine) {
      const index = golfer.rounds.length - 1;
      golfer.rounds[index] = { ...golfer.rounds[index], status: 'MISSED_CUT' };
      golfer.active = false;
    }
  }
}

function participantStatus(
  contestant: ContestantRecord,
  rounds: readonly LiveGolfRoundRecord[],
): ParticipantStatusKind | undefined {
  const terminal = rounds.at(-1)?.status;
  if (terminal === 'MISSED_CUT') return 'cut';
  if (terminal === 'DNF') return 'withdrawn';
  return contestant.participantStatus;
}

export function simulateGolfLiveScores(input: {
  readonly eventSeed: string;
  readonly contestants: readonly ContestantRecord[];
  readonly timeline: GolfLiveTimeline;
  readonly now: Date;
}): readonly LiveGolfContestantRecord[] {
  const { eventSeed, timeline } = input;
  const nowMs = input.now.getTime();
  const golfers = buildGolfers(eventSeed, input.contestants);
  const roundMs = timeline.minutesPerRound * minuteMs;
  const holeMs = (roundMs * playShare) / holesPerRound;

  for (let round = 1; round <= roundsPerEvent; round += 1) {
    const startMs = roundStartMs(timeline, round);
    if (nowMs < startMs) {
      break;
    }

    const field = teeOrder(eventSeed, round, golfers.filter((golfer) => golfer.active));
    const lastSlot = Math.max(1, field.length - 1);
    let everyoneFinished = true;
    field.forEach((golfer, slot) => {
      const teeMs = startMs + (slot / lastSlot) * roundMs * teeWindowShare;
      const played = playRound({ eventSeed, golfer, round, teeMs, holeMs, nowMs });
      if (!played || played.status === 'IN_PROGRESS') {
        everyoneFinished = false;
      }
      if (played) {
        golfer.rounds.push(played);
        if (played.status === 'DNF') golfer.active = false;
      }
    });

    if (!everyoneFinished) {
      break;
    }
    if (round === cutRound) {
      applyCut(golfers);
    }
  }

  return golfers
    .filter((golfer) => golfer.rounds.length > 0)
    .map((golfer) => {
      const { contestant, rounds } = golfer;
      const status = participantStatus(contestant, rounds);
      return {
        contestantId: contestant.contestantId,
        name: contestant.name,
        ...(contestant.teamName ? { teamName: contestant.teamName } : {}),
        ...(contestant.countryCode ? { countryCode: contestant.countryCode } : {}),
        ...(typeof contestant.seed === 'number' ? { seed: contestant.seed } : {}),
        ...(status ? { participantStatus: status } : {}),
        rounds,
      };
    })
    .sort((left, right) => {
      const leftTotal = left.rounds.reduce((sum, round) => sum + round.scoreToPar, 0);
      const rightTotal = right.rounds.reduce((sum, round) => sum + round.scoreToPar, 0);
      return leftTotal - rightTotal || left.name.localeCompare(right.name);
    });
}
