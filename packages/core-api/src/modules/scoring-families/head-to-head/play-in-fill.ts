/**
 * Fills a bracket's play-in place from the provider's play-in result (#1571): the March Madness
 * First Four. A play-in place is one field row standing for the pairing ("UMBC / Howard") until
 * its winner is known, and it names its two teams only in that label. So the place is found by
 * where it sits in the bracket. Once the provider calls a First Four game final, it puts the winner
 * in its round of 64 game, against a team already on the field. That game names the winner
 * (`GameScoreUpdate.playInWinnerTeamExternalId`), and the place is the other side of the one
 * match that opponent plays against a play-in place. The winner goes in through
 * `SportEventBracketService.fillPlayInSlot`, the admin's own path, with all its checks.
 *
 * A place already filled is no longer a play-in place, so it is never filled twice. A game no
 * place fits, or two places fit, is left for the admin, as is a team the provider's mappings do
 * not name. Once the place is filled, both sides of its match are teams the provider names, so
 * the game links and scores like any other, in the same sync.
 */
import type { SportEventMatch } from '@poolmaster/shared/domain';
import type { GameScoreUpdate } from '@poolmaster/shared/dto';
import type { FastifyBaseLogger } from 'fastify';
import type { ParticipantProviderMappingRepository, SportEventParticipantRepository } from '@poolmaster/shared/db';
import { SportEventError } from '../../events/errors';
import type { SportEventBracketService } from '../../events/sport-event-bracket-service';

export interface PlayInFillDeps {
  providerId: string;
  eventParticipants: Pick<SportEventParticipantRepository, 'findBySportEvent'>;
  mappings: Pick<ParticipantProviderMappingRepository, 'findByProviderExternalIds'>;
  playIns: Pick<SportEventBracketService, 'fillPlayInSlot'>;
  logger?: FastifyBaseLogger;
}

/** A game a play-in winner plays, with that winner's team and its opponent's. */
interface PlayInWinnerGame {
  game: GameScoreUpdate;
  winnerExternalId: string;
  opponentExternalId: string;
}

/**
 * Fills the play-in place each unlinked game of a play-in winner fits. Reads nothing when the
 * batch holds no such game.
 */
export async function fillPlayInPlaces(
  deps: PlayInFillDeps,
  sportEventId: string,
  matches: readonly SportEventMatch[],
  games: readonly GameScoreUpdate[],
): Promise<void> {
  const linkedGameIds = new Set(matches.flatMap((match) => (match.externalGameId === null ? [] : [match.externalGameId])));
  const winnerGames = games.flatMap((game): PlayInWinnerGame[] => {
    const winnerExternalId = game.playInWinnerTeamExternalId;
    if (winnerExternalId === undefined || linkedGameIds.has(game.externalGameId)) return [];
    const opponentExternalId = winnerExternalId === game.homeTeamExternalId ? game.awayTeamExternalId : game.homeTeamExternalId;
    return [{ game, winnerExternalId, opponentExternalId }];
  });
  if (winnerGames.length === 0) return;
  const field = await deps.eventParticipants.findBySportEvent(sportEventId);
  const placeIds = new Set(field.filter((row) => row.isPlayInPlace).map((row) => row.id));
  if (placeIds.size === 0) return;
  const teamIds = [...new Set(winnerGames.flatMap((each) => [each.winnerExternalId, each.opponentExternalId]))];
  const mappings = await deps.mappings.findByProviderExternalIds(deps.providerId, teamIds);
  const participantOf = new Map(mappings.map((mapping) => [mapping.externalId, mapping.participantId]));
  const rowOfParticipant = new Map(field.map((row) => [row.participantId, row.id]));

  for (const { game, winnerExternalId, opponentExternalId } of winnerGames) {
    const data = { sportEventId, externalGameId: game.externalGameId, winnerExternalId, opponentExternalId };
    const winnerParticipantId = participantOf.get(winnerExternalId);
    const opponentParticipantId = participantOf.get(opponentExternalId);
    const opponentRowId = opponentParticipantId === undefined ? undefined : rowOfParticipant.get(opponentParticipantId);
    if (winnerParticipantId === undefined || opponentRowId === undefined) {
      deps.logger?.warn(
        { action: 'liveScore.playIn.teamNotOnSite', data: { ...data, winnerMapped: winnerParticipantId !== undefined, opponentOnField: opponentRowId !== undefined } },
        'Left a play-in winner for the admin: the site has no team for it, or its opponent is not on the field',
      );
      continue;
    }
    const places = matches.flatMap((match) => {
      const sides = [match.homeSportEventParticipantId, match.awaySportEventParticipantId];
      const other = sides[0] === opponentRowId ? sides[1] : sides[1] === opponentRowId ? sides[0] : null;
      return other !== null && placeIds.has(other) ? [other] : [];
    });
    if (places.length !== 1) {
      deps.logger?.warn(
        { action: 'liveScore.playIn.noSinglePlace', data: { ...data, places: places.length } },
        'Left a play-in winner for the admin: its opponent plays no single match against a play-in place',
      );
      continue;
    }
    try {
      await deps.playIns.fillPlayInSlot(sportEventId, places[0], winnerParticipantId);
      placeIds.delete(places[0]);
    } catch (error) {
      if (!(error instanceof SportEventError)) throw error;
      deps.logger?.warn(
        { action: 'liveScore.playIn.refused', data: { ...data, code: error.code } },
        'The play-in place refused the provider\'s winner',
      );
    }
  }
}
