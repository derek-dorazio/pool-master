import { TrendingUp, Trophy, Zap, Target } from 'lucide-react';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';
import { useHighlights } from './hooks/use-highlights';

export function SeasonHighlightsCard() {
  const { data: highlights, isLoading, isError } = useHighlights();

  if (isLoading || (!highlights && !isError)) {
    return null;
  }

  if (isError) {
    return (
      <Card data-testid="season-highlights-card">
        <CardContent className="py-6">
          <p role="alert" className="text-sm text-destructive text-center">
            Failed to load season highlights.
          </p>
        </CardContent>
      </Card>
    );
  }

  const stats = [
    {
      icon: Trophy,
      label: 'Recent Win',
      value: highlights.recentWin ?? 'None yet',
    },
    {
      icon: Target,
      label: 'Personal Best',
      value: `${highlights.personalBest} pts`,
    },
    {
      icon: Zap,
      label: 'Current Streak',
      value: `${highlights.currentStreak}-win streak`,
    },
    {
      icon: TrendingUp,
      label: 'Season Record',
      value: `${highlights.seasonRecord.wins}W - ${highlights.seasonRecord.losses}L`,
    },
  ];

  return (
    <Card data-testid="season-highlights-card">
      <CardHeader className="pb-2">
        <CardTitle className="text-lg font-semibold flex items-center gap-2">
          <TrendingUp className="h-5 w-5 text-primary" />
          Season Highlights
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          {stats.map((stat) => (
            <div
              key={stat.label}
              className="flex flex-col items-center rounded-md border p-4 text-center"
            >
              <stat.icon className="h-5 w-5 text-primary mb-2" />
              <p className="text-xs text-muted-foreground mb-1">{stat.label}</p>
              <p className="text-sm font-semibold">{stat.value}</p>
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}
