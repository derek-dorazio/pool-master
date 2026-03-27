import { useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';

interface TimelineEntry {
  entryId: string;
  entryName: string;
  color: string;
  checkpoints: number[];
}

interface ScoreTimelineProps {
  checkpointLabels: string[];
  entries: TimelineEntry[];
}

const CHART_HEIGHT = 280;
const CHART_PADDING = { top: 20, right: 20, bottom: 40, left: 50 };

export function ScoreTimeline({ checkpointLabels, entries }: ScoreTimelineProps) {
  const [selectedEntries, setSelectedEntries] = useState<Set<string>>(
    new Set(entries.slice(0, 5).map((e) => e.entryId)),
  );

  function toggleEntry(entryId: string) {
    const next = new Set(selectedEntries);
    if (next.has(entryId)) next.delete(entryId);
    else next.add(entryId);
    setSelectedEntries(next);
  }

  const visibleEntries = entries.filter((e) => selectedEntries.has(e.entryId));
  const allValues = visibleEntries.flatMap((e) => e.checkpoints);
  const minVal = allValues.length > 0 ? Math.min(...allValues) : 0;
  const maxVal = allValues.length > 0 ? Math.max(...allValues) : 100;
  const range = maxVal - minVal || 1;

  const chartWidth = Math.max(400, checkpointLabels.length * 80);
  const plotWidth = chartWidth - CHART_PADDING.left - CHART_PADDING.right;
  const plotHeight = CHART_HEIGHT - CHART_PADDING.top - CHART_PADDING.bottom;

  function xPos(idx: number): number {
    return CHART_PADDING.left + (idx / Math.max(checkpointLabels.length - 1, 1)) * plotWidth;
  }

  function yPos(val: number): number {
    return CHART_PADDING.top + plotHeight - ((val - minVal) / range) * plotHeight;
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-lg">Score Timeline</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Entry toggles */}
        <div className="flex flex-wrap gap-1.5">
          {entries.map((entry) => (
            <Badge
              key={entry.entryId}
              variant={selectedEntries.has(entry.entryId) ? 'default' : 'outline'}
              className="cursor-pointer text-xs"
              style={selectedEntries.has(entry.entryId) ? { backgroundColor: entry.color, borderColor: entry.color } : {}}
              onClick={() => toggleEntry(entry.entryId)}
            >
              {entry.entryName}
            </Badge>
          ))}
        </div>

        {/* SVG chart */}
        <div className="overflow-x-auto">
          <svg
            width={chartWidth}
            height={CHART_HEIGHT}
            className="font-sans"
            role="img"
            aria-label="Score timeline chart"
          >
            {/* Grid lines */}
            {Array.from({ length: 5 }).map((_, i) => {
              const val = minVal + (range / 4) * i;
              const y = yPos(val);
              return (
                <g key={i}>
                  <line
                    x1={CHART_PADDING.left}
                    y1={y}
                    x2={CHART_PADDING.left + plotWidth}
                    y2={y}
                    stroke="currentColor"
                    strokeOpacity={0.1}
                  />
                  <text x={CHART_PADDING.left - 8} y={y + 4} textAnchor="end" className="fill-muted-foreground text-[10px]">
                    {Math.round(val)}
                  </text>
                </g>
              );
            })}

            {/* X-axis labels */}
            {checkpointLabels.map((label, i) => (
              <text
                key={i}
                x={xPos(i)}
                y={CHART_HEIGHT - 8}
                textAnchor="middle"
                className="fill-muted-foreground text-[10px]"
              >
                {label}
              </text>
            ))}

            {/* Lines */}
            {visibleEntries.map((entry) => {
              const points = entry.checkpoints.map((val, i) => `${xPos(i)},${yPos(val)}`).join(' ');
              return (
                <g key={entry.entryId}>
                  <polyline
                    points={points}
                    fill="none"
                    stroke={entry.color}
                    strokeWidth={2}
                    strokeLinejoin="round"
                  />
                  {entry.checkpoints.map((val, i) => (
                    <circle
                      key={i}
                      cx={xPos(i)}
                      cy={yPos(val)}
                      r={3}
                      fill={entry.color}
                    >
                      <title>{entry.entryName}: {val} pts</title>
                    </circle>
                  ))}
                </g>
              );
            })}
          </svg>
        </div>
      </CardContent>
    </Card>
  );
}
