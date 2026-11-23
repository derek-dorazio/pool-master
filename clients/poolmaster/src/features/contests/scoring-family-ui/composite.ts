/**
 * Composite's leaderboard (championship stat pools, #936): the pick's total is their games'
 * composites summed. A series (#1747) heads one column per game, each cell the player's composite
 * in that game, and hovering or tapping a score shows the stats it was made from; a single-game
 * event (a CFP or Super Bowl pool) has no game columns, since one would only repeat the total.
 * With an entry's Stats switch on, a line under each player's name gives their stats in the
 * current game, or their latest. The scores are the server's (`composite` on the pick); the
 * stats are the field's own stat lines, named by `enumLabel('SportStat', …)`.
 */

import {
  PARTICIPANT_SCORING_DEFINITIONS,
  ParticipantRoundStatus,
  type SportStat,
} from '@poolmaster/shared/domain';
import { enumLabel } from '@poolmaster/shared/display-strings';
import type { SportEventParticipantDto } from '@/lib/api';
import { upperFirst } from '@/lib/upper-first';
import { resolveRoundNumbers } from '../contest-leaderboard-rounds';
import { formatSportStatCount } from './stat-labels';
import type { ScoringFamilyUi } from './types';

const DID_NOT_PLAY = 'did not play';
/** A live game the player has no line in yet: they may still check in, so not "did not play". */
const NOT_IN_YET = 'not in yet';

/**
 * "15 pts · 6 reb · 4 ast": a game's stats in the composite's order, each with its unit written
 * out. A stat at 0 is left out, so a football line names what the player did; a line of zeros
 * reads as its first stat. Null when the player has no line in the game.
 */
function statLineText(participant: SportEventParticipantDto, roundNumber: number, stats: readonly SportStat[]): string | null {
  const shown = shownStats(participant, roundNumber, stats);
  return shown === null ? null : shown.map(({ stat, value }) => formatSportStatCount(stat, value)).join(' · ');
}

/** The stats a game's line shows, in the composite's order: those not at 0, or the first if all are. Null with no line. */
function shownStats(participant: SportEventParticipantDto, roundNumber: number, stats: readonly SportStat[]) {
  const lines = participant.rounds.find((round) => round.roundNumber === roundNumber)?.statLines ?? [];
  if (lines.length === 0) {
    return null;
  }
  const byStat = new Map(lines.map((line) => [line.stat, line.value]));
  const counted = stats.flatMap((stat) => {
    const value = byStat.get(stat);
    return value === undefined ? [] : [{ stat, value }];
  });
  const nonZero = counted.filter((line) => line.value !== 0);
  return nonZero.length > 0 ? nonZero : counted.slice(0, 1);
}

/** The game in play right now: the highest any player is part way through, else none. */
function liveGameNumber(participants: readonly SportEventParticipantDto[]): number | null {
  const live = participants.flatMap((participant) => participant.rounds
    .filter((round) => round.status === ParticipantRoundStatus.IN_PROGRESS)
    .map((round) => round.roundNumber));
  return live.length === 0 ? null : Math.max(...live);
}

export const compositeUi: ScoringFamilyUi = {
  // A composite total breaks no ties with a prediction: entries submit without one.
  entryTiebreaker: null,
  leaderboard(response, sport) {
    const definition = PARTICIPANT_SCORING_DEFINITIONS[response.scoringDefinitionId];
    const stats = sport.composite?.stats ?? [];
    // A game has a column once any player in the field has a line in it.
    const gameNumbers = resolveRoundNumbers(response.participants);
    const isSingleGame = (sport.composite?.defaultGames ?? 1) === 1;
    const liveGame = liveGameNumber(response.participants);
    const columnGames = isSingleGame ? [] : gameNumbers;

    return {
      detailColumns: columnGames.map((roundNumber) => ({
        key: `game-${roundNumber}`,
        label: `G${roundNumber}`,
        testId: `contest-leaderboard-round-header-${roundNumber}`,
        // A live game's head carries its marker under the label, so the track is no wider.
        width: 'minmax(40px,0.3fr)',
        isLive: roundNumber === liveGame || undefined,
      })),
      footnote: null,
      pickDetail(entryId, pick, participant) {
        const scores = new Map((pick.composite?.games ?? []).map((game) => [game.roundNumber, game.score]));
        const playerName = participant.participant.name;
        return {
          total: pick.composite?.points == null ? null : definition.format(pick.composite.points),
          detailCells: columnGames.map((roundNumber) => {
            const score = scores.get(roundNumber);
            const line = shownStats(participant, roundNumber, stats);
            return {
              key: `game-${roundNumber}`,
              testId: `contest-leaderboard-pick-round-${entryId}-${pick.pickId}-${roundNumber}`,
              // A game still being played may not have reached the player yet; a finished one they had no line in, they missed.
              text: score === undefined ? (roundNumber === liveGame ? null : 'DNP') : definition.format(score),
              peek: score === undefined || line === null ? undefined : {
                title: `G${String(roundNumber)} · ${playerName}`,
                facts: line.map(({ stat, value }) => ({ label: enumLabel('SportStat', stat), value: String(value) })),
              },
            };
          }),
          statLine: statLineFor(participant, gameNumbers, liveGame, isSingleGame, stats),
        };
      },
    };
  },
};

/**
 * The line under a player's name: the game being played right now (not in yet, while they have
 * no line in it), else the player's latest game with a line, else the board's latest game,
 * which they did not play. A series names the
 * game ("G4: 15 pts · 6 reb"); a single game needs no name. Absent before any game has a line.
 */
function statLineFor(
  participant: SportEventParticipantDto,
  gameNumbers: readonly number[],
  liveGame: number | null,
  isSingleGame: boolean,
  stats: readonly SportStat[],
): string | undefined {
  const latestGame = gameNumbers.at(-1);
  if (latestGame === undefined) {
    return undefined;
  }
  const playedGames = gameNumbers.filter((roundNumber) => statLineText(participant, roundNumber, stats) !== null);
  const shownGame = liveGame ?? playedGames.at(-1) ?? latestGame;
  const text = statLineText(participant, shownGame, stats) ?? (shownGame === liveGame ? NOT_IN_YET : DID_NOT_PLAY);
  return isSingleGame ? upperFirst(text) : `G${String(shownGame)}: ${text}`;
}
