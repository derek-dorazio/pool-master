import { Chip, Heading } from '@/features/shared/ui';
import {
  describeOpenSide,
  describePickOutcome,
  offeredTeams,
  type BracketGame,
  type BracketRound,
  type BracketTeam,
} from './bracket-layout';
import { EmptyPickSlot } from './empty-pick-slot';
import { GameCard } from './game-card';
import { PickedLine, PickOption } from './pick-option';

function BracketGameCard({
  canPick,
  game,
  isBusy,
  onPick,
  openSide,
}: {
  canPick: boolean;
  game: BracketGame;
  isBusy: boolean;
  onPick: (game: BracketGame, team: BracketTeam) => void;
  openSide: string;
}) {
  const pickedId = game.pick?.sportEventParticipantId ?? null;
  // A pick is only marked against the results once the game is under way: before then every
  // pick is still pending, and saying so on each game is noise.
  const outcome = game.pick && (game.locked || game.revealed) ? describePickOutcome(game.pick) : null;
  const choosable = canPick && !game.locked;
  return (
    <GameCard
      aside={outcome ? (
        <Chip data-testid={`bracket-game-${game.matchNumber}-outcome`} tone={outcome.tone}>{outcome.label}</Chip>
      ) : undefined}
      density="compact"
      label={<span>{`Game ${game.matchNumber}`}</span>}
      testId={`bracket-game-${game.matchNumber}`}
    >
      {offeredTeams(game).map((team, index) => {
        if (!team) {
          return (
            <EmptyPickSlot
              key={index === 0 ? 'home' : 'away'}
              testId={`bracket-game-${game.matchNumber}-open-${index === 0 ? 'home' : 'away'}`}
            >
              {openSide}
            </EmptyPickSlot>
          );
        }
        const isPicked = team.sportEventParticipantId === pickedId;
        const testId = `bracket-game-${game.matchNumber}-team-${team.sportEventParticipantId}`;
        return choosable ? (
          <PickOption
            isBusy={isBusy}
            isPicked={isPicked}
            key={team.sportEventParticipantId}
            onPick={() => onPick(game, team)}
            testId={testId}
          >
            <span className="truncate">{team.name}</span>
          </PickOption>
        ) : (
          <PickedLine isPicked={isPicked} key={team.sportEventParticipantId} testId={testId}>
            <span className="truncate">{team.name}</span>
          </PickedLine>
        );
      })}
    </GameCard>
  );
}

/**
 * A bracket, round by round and region by region (#721). An entry's own bracket before the event
 * starts is a picker: each game offers the two teams the entry's earlier picks sent there. After
 * that, or on someone else's entry, it is the filled bracket, each pick marked correct, busted or
 * pending with what it earned.
 */
export function BracketBoard({
  canPick,
  isBusy,
  onPick,
  rounds,
}: {
  /** Whether the viewer may pick in this bracket now: their own entry, before its games lock. */
  canPick: boolean;
  /** A pick is being saved: the choices wait for the server's answer. */
  isBusy: boolean;
  onPick: (game: BracketGame, team: BracketTeam) => void;
  rounds: readonly BracketRound[];
}) {
  return (
    <div className="space-y-8" data-testid="bracket-board">
      {rounds.map((round) => (
        <section aria-labelledby={`bracket-round-${round.roundNumber}`} className="space-y-4" data-testid={`bracket-round-${round.roundNumber}`} key={round.roundNumber}>
          <Heading level={3} variant="card" size="lg" tone="inherit" id={`bracket-round-${round.roundNumber}`}>{round.label}</Heading>
          {round.regions.map((region) => (
            <div className="space-y-2" key={region.regionLabel ?? ''}>
              {region.regionLabel ? (
                <Heading level={4} variant="eyebrow">{region.regionLabel}</Heading>
              ) : null}
              <ul className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
                {region.games.map((game) => (
                  <BracketGameCard
                    canPick={canPick}
                    game={game}
                    isBusy={isBusy}
                    key={game.sportEventMatchId}
                    onPick={onPick}
                    openSide={describeOpenSide(round, rounds)}
                  />
                ))}
              </ul>
            </div>
          ))}
        </section>
      ))}
    </div>
  );
}
