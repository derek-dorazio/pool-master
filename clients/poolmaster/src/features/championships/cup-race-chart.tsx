import { cn } from '@/features/shared/ui';
import { formatCupPoints, type RaceSeries } from './cup-view';

const WIDTH = 340;
const HEIGHT = 140;
const PAD = 10;

/** One class per line, in the order the series come (rules/react-ui-rules.md: theme tokens, no raw colors). */
const SERIES_STROKES = ['stroke-chart-1', 'stroke-chart-2', 'stroke-chart-3', 'stroke-chart-4', 'stroke-chart-5'] as const;
const SERIES_SWATCHES = ['bg-chart-1', 'bg-chart-2', 'bg-chart-3', 'bg-chart-4', 'bg-chart-5'] as const;

function linePoints(points: number[], steps: number, max: number) {
  return points
    .map((value, index) => {
      const x = PAD + (index / steps) * (WIDTH - PAD * 2);
      const y = HEIGHT - PAD - (value / max) * (HEIGHT - PAD * 2);
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(' ');
}

/**
 * The race so far: the top squads' running totals after each counted contest, from 0. The focus
 * squad's line is drawn heavier. Before any contest has counted there is nothing to draw.
 */
export function CupRaceChart({ focusSquadId, series }: { focusSquadId: string | null; series: RaceSeries[] }) {
  const steps = Math.max(0, ...series.map((line) => line.points.length - 1));
  if (steps === 0) {
    return <p className="text-sm text-muted-foreground">The chart starts once a contest has counted.</p>;
  }
  const max = Math.max(1, ...series.flatMap((line) => line.points));
  const summary = series
    .map((line) => `${line.squadName} ${formatCupPoints(line.points.at(-1) ?? 0)}`)
    .join(', ');

  return (
    <figure className="space-y-3" data-testid="cup-race-chart">
      <svg
        aria-label={`Points after each counted contest. ${summary}.`}
        className="h-auto w-full"
        role="img"
        viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
      >
        {[0, 0.5, 1].map((fraction) => {
          const y = HEIGHT - PAD - fraction * (HEIGHT - PAD * 2);
          return <line className="stroke-chart-grid" key={fraction} strokeWidth={1} x1={PAD} x2={WIDTH - PAD} y1={y} y2={y} />;
        })}
        {series.map((line, index) => (
          <polyline
            className={SERIES_STROKES[index % SERIES_STROKES.length]}
            data-testid={`cup-race-line-${line.squadId}`}
            fill="none"
            key={line.squadId}
            points={linePoints(line.points, steps, max)}
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={line.squadId === focusSquadId ? 3.5 : 2}
          />
        ))}
      </svg>
      <figcaption className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
        {series.map((line, index) => (
          <span className="inline-flex items-center gap-1.5" key={line.squadId}>
            <span aria-hidden className={cn('h-2 w-3 rounded-sm', SERIES_SWATCHES[index % SERIES_SWATCHES.length])} />
            <span className={line.squadId === focusSquadId ? 'font-semibold text-foreground' : undefined}>{line.squadName}</span>
          </span>
        ))}
      </figcaption>
    </figure>
  );
}
