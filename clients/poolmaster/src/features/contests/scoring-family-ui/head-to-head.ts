/**
 * Head to head's leaderboard (knockout brackets, #699, #1748): after the total, a Wins column, an
 * Upset column when the contest scores an upset bonus, and a Status chip saying whether the team
 * is still in, or the round it went out in. Where the board has read the event's games, a
 * team's Wins open every game it played and its next one, and the entry's Stats switch puts its
 * latest game under its name. A pick's total is its knockout round points, rendered through the
 * contest's participant scoring definition (`PARTICIPANT_SCORING_DEFINITIONS`). Until the bracket
 * has a result no team has points.
 */

import {
  isMatchUnplayed,
  MatchSide,
  MatchStatus,
  PARTICIPANT_SCORING_DEFINITIONS,
  ParticipantStandingStatus,
  type SportDefinition,
  sportVocabulary,
} from '@poolmaster/shared/domain';
import type { ScoredContestEntryPickDto, SportEventRoundMatchDto, SportEventParticipantDto } from '@/lib/api';
import type { LeaderboardContext, LeaderboardDetailCell, LeaderboardDetailColumn, ScoringFamilyUi } from './types';

/** A team's games, from its own side: who it played, whether it won, and the score its way round. */
interface TeamGame {
  match: SportEventRoundMatchDto;
  opponentId: string | null;
  won: boolean;
  /**
   * "81–76", the team's score first; null for a game with no score, such as a walkover. A word
   * joiner follows the dash, which a line may otherwise break after, so a score never splits.
   */
  score: string | null;
}

function teamGames(games: readonly SportEventRoundMatchDto[], teamId: string): TeamGame[] {
  return games
    .filter((match) => match.homeSportEventParticipantId === teamId || match.awaySportEventParticipantId === teamId)
    .map((match) => {
      const isHome = match.homeSportEventParticipantId === teamId;
      const own = isHome ? match.homeScore : match.awayScore;
      const theirs = isHome ? match.awayScore : match.homeScore;
      return {
        match,
        opponentId: isHome ? match.awaySportEventParticipantId : match.homeSportEventParticipantId,
        won: match.winnerSide === (isHome ? MatchSide.HOME : MatchSide.AWAY),
        score: own === null || theirs === null ? null : `${String(own)}–\u2060${String(theirs)}`,
      };
    })
    .sort((left, right) => left.match.roundNumber - right.match.roundNumber || left.match.matchNumber - right.match.matchNumber);
}

/** "beat Gonzaga 81–76", "lost to Arizona 70–74". */
function describeResult(game: TeamGame, nameOf: (id: string | null) => string): string {
  const verb = game.won ? 'beat' : 'lost to';
  return [verb, nameOf(game.opponentId), game.score].filter((part) => part !== null).join(' ');
}

/**
 * The Status chip: the champion, "In" for a team still in the bracket, "Out · Sweet 16" for one
 * knocked out (the round from the game it lost, where the board has read the games), the sport's
 * word for a withdrawn team, or null (a dash) before the team has any knockout result.
 */
export function formatKnockoutStatus(
  pick: ScoredContestEntryPickDto,
  participant: SportEventParticipantDto,
  sport: SportDefinition,
  context?: LeaderboardContext,
): Pick<LeaderboardDetailCell, 'text' | 'chip'> {
  if (!participant.isActive) {
    return { text: sportVocabulary(sport).withdrawn, chip: 'neutral' };
  }
  if (participant.standing?.status === ParticipantStandingStatus.COMPLETE) {
    return { text: 'Champion', chip: 'success' };
  }
  const knockout = pick.knockout;
  if (!knockout) {
    return { text: null };
  }
  if (knockout.isAlive) {
    return { text: 'In', chip: 'success' };
  }
  const lost = teamGames(context?.games ?? [], participant.id)
    .find((game) => game.match.status === MatchStatus.COMPLETED && !game.won);
  return { text: lost && context ? `Out · ${context.roundName(lost.match.roundNumber)}` : 'Out', chip: 'neutral' };
}

export const headToHeadUi: ScoringFamilyUi = {
  // The tiebreaker (one total-points prediction) arrives with bracket pools.
  entryTiebreaker: null,
  leaderboard(response, sport, context) {
    const definition = PARTICIPANT_SCORING_DEFINITIONS[response.scoringDefinitionId];
    const showsBonus = response.upsetBonus;
    // Opponents go by their short name where the field has one, so a result fits a phone row.
    const names = new Map(response.participants.map((row) => [row.id, row.participant.shortName ?? row.participant.name]));
    const nameOf = (id: string | null) => (id === null ? 'TBD' : names.get(id) ?? 'TBD');
    const detailColumns: LeaderboardDetailColumn[] = [
      { key: 'wins', label: 'Wins', testId: 'contest-leaderboard-wins-header', width: 'minmax(48px,0.3fr)' },
      ...(showsBonus
        ? [{ key: 'upset-bonus', label: 'Upset', testId: 'contest-leaderboard-upset-bonus-header', width: 'minmax(56px,0.3fr)' }]
        : []),
      { key: 'status', label: 'Status', testId: 'contest-leaderboard-status-header', width: 'minmax(128px,0.6fr)' },
    ];
    return {
      detailColumns,
      footnote: null,
      pickDetail(entryId, pick, participant) {
        const knockout = pick.knockout;
        const points = knockout?.points ?? null;
        const games = teamGames(context?.games ?? [], participant.id);
        const played = games.filter((game) => game.match.status === MatchStatus.COMPLETED);
        const latest = played.at(-1);
        // A team still in plays next in the earliest round it has a game not yet finished.
        const next = knockout?.isAlive
          ? games.find((game) => isMatchUnplayed(game.match.status) || game.match.status === MatchStatus.IN_PROGRESS)
          : undefined;
        const facts = context ? [
          ...played.map((game) => ({ label: context.roundName(game.match.roundNumber), value: describeResult(game, nameOf) })),
          ...(next ? [{
            label: context.roundName(next.match.roundNumber),
            value: `vs ${nameOf(next.opponentId)} · ${next.match.status === MatchStatus.IN_PROGRESS
              ? 'playing now'
              : next.match.scheduledDate === null ? 'time to be set' : context.formatStart(next.match.scheduledDate)}`,
          }] : []),
        ] : [];
        const winsText = knockout && points !== null ? String(knockout.wins) : null;
        return {
          total: points === null ? null : definition.format(points),
          detailCells: [
            {
              key: 'wins',
              testId: `contest-leaderboard-pick-wins-${entryId}-${pick.pickId}`,
              text: winsText,
              peek: facts.length === 0 ? undefined : { title: participant.participant.name, facts },
            },
            ...(showsBonus
              ? [{
                key: 'upset-bonus',
                testId: `contest-leaderboard-pick-upset-bonus-${entryId}-${pick.pickId}`,
                text: knockout && points !== null && knockout.upsetBonusPoints > 0 ? `+${String(knockout.upsetBonusPoints)}` : null,
              }]
              : []),
            {
              key: 'status',
              testId: `contest-leaderboard-pick-status-${entryId}-${pick.pickId}`,
              ...formatKnockoutStatus(pick, participant, sport, context),
            },
          ],
          statLine: latest && context ? `${context.roundName(latest.match.roundNumber)}: ${describeResult(latest, nameOf)}` : undefined,
        };
      },
    };
  },
};
