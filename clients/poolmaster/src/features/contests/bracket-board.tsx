import { Check } from 'lucide-react';
import { Button, Chip, cn } from '@/features/shared/ui';
import {
  describeOpenSide,
  describePickOutcome,
  offeredTeams,
  type BracketGame,
  type BracketRound,
  type BracketTeam,
} from './bracket-layout';

/** One side of a game the entry can pick: its team, as a choice. */
function TeamChoice({
  game,
  isBusy,
  isPicked,
  onPick,
  team,
}: {
  game: BracketGame;
  isBusy: boolean;
  isPicked: boolean;
  onPick: (game: BracketGame, team: BracketTeam) => void;
  team: BracketTeam;
}) {
  return (
    <Button
      aria-pressed={isPicked}
      className="w-full justify-between text-left"
      data-testid={`bracket-game-${game.matchNumber}-team-${team.sportEventParticipantId}`}
      disabled={isBusy}
      onClick={() => {
        if (!isPicked) {
          onPick(game, team);
        }
      }}
      size="sm"
      variant={isPicked ? 'subtle' : 'secondary'}
    >
      <span className="truncate">{team.name}</span>
      {isPicked ? <Check aria-label="Your pick" size={16} /> : null}
    </Button>
  );
}

/** One side of a game as it was filled in: the team, marked when it is the entry's pick. */
function TeamLine({ game, isPicked, team }: { game: BracketGame; isPicked: boolean; team: BracketTeam }) {
  return (
    <div
      className={cn(
        'flex h-9 items-center justify-between gap-2 rounded-2xl border px-3 text-sm',
        isPicked ? 'border-primary/30 bg-primary/10 font-semibold' : 'border-border text-muted-foreground',
      )}
      data-picked={isPicked || undefined}
      data-testid={`bracket-game-${game.matchNumber}-team-${team.sportEventParticipantId}`}
    >
      <span className="truncate">{team.name}</span>
      {isPicked ? <Check aria-label="Picked" size={16} /> : null}
    </div>
  );
}

function GameCard({
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
    <li
      className="space-y-2 rounded-2xl border border-border bg-background p-3"
      data-testid={`bracket-game-${game.matchNumber}`}
    >
      <div className="flex items-center justify-between gap-2 text-xs text-muted-foreground">
        <span>{`Game ${game.matchNumber}`}</span>
        {outcome ? (
          <Chip data-testid={`bracket-game-${game.matchNumber}-outcome`} tone={outcome.tone}>{outcome.label}</Chip>
        ) : null}
      </div>
      {offeredTeams(game).map((team, index) => {
        if (!team) {
          return (
            <div
              className="flex h-9 items-center rounded-2xl border border-dashed border-border px-3 text-sm text-muted-foreground"
              data-testid={`bracket-game-${game.matchNumber}-open-${index === 0 ? 'home' : 'away'}`}
              key={index === 0 ? 'home' : 'away'}
            >
              {openSide}
            </div>
          );
        }
        const isPicked = team.sportEventParticipantId === pickedId;
        return choosable ? (
          <TeamChoice game={game} isBusy={isBusy} isPicked={isPicked} key={team.sportEventParticipantId} onPick={onPick} team={team} />
        ) : (
          <TeamLine game={game} isPicked={isPicked} key={team.sportEventParticipantId} team={team} />
        );
      })}
    </li>
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
          <h3 className="text-lg font-semibold" id={`bracket-round-${round.roundNumber}`}>{round.label}</h3>
          {round.regions.map((region) => (
            <div className="space-y-2" key={region.regionLabel ?? ''}>
              {region.regionLabel ? (
                <h4 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">{region.regionLabel}</h4>
              ) : null}
              <ul className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
                {region.games.map((game) => (
                  <GameCard
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
