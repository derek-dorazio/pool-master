import { TeamLine, Text, cn } from '@/features/shared/ui';
import type { BracketTeam } from './bracket-layout';
import type { BracketDrawnGame, BracketDrawnRound, BracketLine } from './bracket-view-model';

/** What a bracket does when a team is tapped: the entry's pick, while it can still pick. */
export interface BracketPicking {
  isBusy: boolean;
  onPick: (game: BracketDrawnGame['game'], team: BracketTeam) => void;
}

function GameLines({ drawn, isMirrored, picking }: { drawn: BracketDrawnGame; isMirrored: boolean; picking: BracketPicking | null }) {
  const { game } = drawn;
  const choosable = picking !== null && !game.locked;
  return (
    <div className="flex flex-1 flex-col justify-center gap-0.5 py-1" data-testid={`bracket-game-${game.roundNumber}-${game.matchNumber}`}>
      {drawn.lines.map((line, index) => {
        const side = index === 0 ? 'home' : 'away';
        if (!line.team) {
          return (
            <TeamLine
              isMirrored={isMirrored}
              isOpen
              key={side}
              name={line.openLabel}
              testId={`bracket-game-${game.roundNumber}-${game.matchNumber}-open-${side}`}
            />
          );
        }
        const team = line.team;
        return (
          <TeamLine
            actualName={line.actual?.name}
            disabled={picking?.isBusy}
            isMirrored={isMirrored}
            isPicked={choosable && line.isPicked}
            key={side}
            mark={line.mark}
            name={team.name}
            onPick={choosable ? () => picking.onPick(game, team) : undefined}
            seed={team.seedNumber}
            testId={`bracket-game-${game.roundNumber}-${game.matchNumber}-team-${team.sportEventParticipantId}`}
          />
        );
      })}
    </div>
  );
}

/** A region's winner, as the last column of its tree on a phone. */
function WinnerColumn({ isMirrored, line, testId }: { isMirrored: boolean; line: BracketLine | null; testId: string }) {
  return (
    <div className="flex min-w-0 flex-1 flex-col justify-center" data-testid={testId}>
      {line?.team ? (
        <TeamLine actualName={line.actual?.name} isMirrored={isMirrored} mark={line.mark} name={line.team.name} seed={line.team.seedNumber} />
      ) : (
        <TeamLine isMirrored={isMirrored} isOpen name="Winner" />
      )}
    </div>
  );
}

/**
 * A run of a bracket's rounds side by side, each round a column whose games sit between the two
 * games that feed them, as on paper. Mirrored, the rounds run right to left toward the middle.
 */
export function BracketTree({
  columnClassName,
  isMirrored = false,
  picking,
  rounds,
  showHeaders,
  winner,
}: {
  /** A column's width: fixed on a desktop, an even share of the screen on a phone. */
  columnClassName: string;
  isMirrored?: boolean;
  picking: BracketPicking | null;
  rounds: readonly BracketDrawnRound[];
  /** Each column's round name above it; a phone names them in its round row instead. */
  showHeaders: boolean;
  /** A last column holding the region's winner, with its test id; omitted, none. */
  winner?: { line: BracketLine | null; testId: string };
}) {
  return (
    <div className={cn('flex items-stretch gap-2', isMirrored && 'flex-row-reverse')}>
      {rounds.map((round) => (
        <div className={cn('flex flex-col', columnClassName)} data-testid={`bracket-round-${round.roundNumber}`} key={round.roundNumber}>
          {showHeaders ? (
            <Text className={cn('pb-1', isMirrored && 'text-right')} variant="label">{round.label}</Text>
          ) : null}
          <div className="flex flex-1 flex-col">
            {round.games.map((drawn) => (
              <GameLines drawn={drawn} isMirrored={isMirrored} key={drawn.game.sportEventRoundMatchId} picking={picking} />
            ))}
          </div>
        </div>
      ))}
      {winner ? (
        <div className={cn('flex flex-col', columnClassName)}>
          <WinnerColumn isMirrored={isMirrored} line={winner.line} testId={winner.testId} />
        </div>
      ) : null}
    </div>
  );
}
