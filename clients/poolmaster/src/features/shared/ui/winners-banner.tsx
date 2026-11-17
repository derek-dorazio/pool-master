import { Text } from "./text";
import { Tile } from "./tile";
import { TrophyMark, type TrophyMetal } from "./trophy-mark";

/** One place on a final contest's podium: its words over the names, the entries there and their score. */
export type WinnersPlace = {
  /** "Winner", "Tied for 1st", "2nd" or "Tied for 3rd". */
  label: string;
  metal: TrophyMetal;
  /** Every entry at the place, a tie naming each one. */
  names: string[];
  /** The place's score as the board words it, such as "11 pts". */
  score: string;
};

/**
 * A final contest's winners (#1768), above its standings: a gold-edged card with the gold
 * trophy, the winner and their score, 2nd and 3rd beside it in small boxes with silver and
 * bronze trophies, and, when the viewer entered, one blue line with their finish.
 */
export function WinnersBanner({
  runnersUp,
  testId,
  winner,
  yourFinish,
}: {
  /** 2nd and 3rd, those the board has; none when every entry tied for 1st. */
  runnersUp: WinnersPlace[];
  testId: string;
  winner: WinnersPlace;
  /** "You finished 3rd of 14", or null when the viewer has no entry. */
  yourFinish: string | null;
}) {
  return (
    <Tile as="section" aria-label="Winners" className="space-y-3" data-testid={testId} edge="open">
      <div className="grid gap-3 sm:grid-cols-[minmax(0,2fr)_minmax(0,1fr)_minmax(0,1fr)]">
        <div className="flex items-center gap-3" data-testid={`${testId}-winner`}>
          <TrophyMark className="h-12 w-12 shrink-0" metal={winner.metal} />
          <div className="min-w-0">
            <Text variant="label">{winner.label}</Text>
            <Text as="p" data-testid={`${testId}-winner-names`} size="lg" variant="display">{winner.names.join(", ")}</Text>
            <Text as="p" data-testid={`${testId}-winner-score`} tone="muted" variant="value">{winner.score}</Text>
          </div>
        </div>
        {runnersUp.map((place) => (
          <Tile className="flex items-center gap-2" data-testid={`${testId}-${place.metal}`} key={place.metal} padding="sm" variant="subtle">
            <TrophyMark className="h-6 w-6 shrink-0" metal={place.metal} />
            <div className="min-w-0">
              <Text variant="label">{place.label}</Text>
              <Text as="p" truncate>{`${place.names.join(", ")} · ${place.score}`}</Text>
            </div>
          </Tile>
        ))}
      </div>
      {yourFinish ? (
        <p
          className="rounded-lg border border-[color:var(--status-info-border)] bg-[var(--status-info-surface)] px-3 py-2 text-sm font-semibold [color:var(--status-info-text)]"
          data-testid={`${testId}-yours`}
        >
          {yourFinish}
        </p>
      ) : null}
    </Tile>
  );
}
