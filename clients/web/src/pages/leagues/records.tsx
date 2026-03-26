import { useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { Trophy, Flame, Star, Target, TrendingUp, Award } from 'lucide-react';
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Button } from '@/components/ui/button';

interface LeagueRecord {
  id: string;
  name: string;
  holder: string;
  value: string;
  icon: 'trophy' | 'flame' | 'star' | 'target' | 'trending' | 'award';
  date: string;
}

const mockRecords: LeagueRecord[] = [
  {
    id: 'r1',
    name: 'Best Weekly Score',
    holder: 'Sarah Kim',
    value: '15/16 correct',
    icon: 'trophy',
    date: 'Week 8, 2025',
  },
  {
    id: 'r2',
    name: 'Most Contest Wins',
    holder: 'Dan Miller',
    value: '7 wins',
    icon: 'award',
    date: 'All-time',
  },
  {
    id: 'r3',
    name: 'Longest Win Streak',
    holder: 'Mike Johnson',
    value: '4 weeks',
    icon: 'flame',
    date: 'Weeks 5-8, 2025',
  },
  {
    id: 'r4',
    name: 'Best Draft Pick',
    holder: 'Chris Park',
    value: 'Patrick Mahomes (Rd 3)',
    icon: 'star',
    date: 'Draft 2025',
  },
  {
    id: 'r5',
    name: 'Highest Season Score',
    holder: 'Sarah Kim',
    value: '187 points',
    icon: 'trending',
    date: '2025 Season',
  },
  {
    id: 'r6',
    name: 'Most Accurate Picker',
    holder: 'Amy Lee',
    value: '72% accuracy',
    icon: 'target',
    date: '2025 Season',
  },
];

const iconMap = {
  trophy: Trophy,
  flame: Flame,
  star: Star,
  target: Target,
  trending: TrendingUp,
  award: Award,
};

function useRecords(leagueId: string) {
  return useQuery({
    queryKey: ['league-records', leagueId],
    queryFn: async () => mockRecords,
    initialData: mockRecords,
  });
}

export function Component() {
  const { leagueId } = useParams<{ leagueId: string }>();
  const { data: records = [] } = useRecords(leagueId!);

  return (
    <div className="space-y-6">
      <h1 className="text-3xl font-bold">League Records</h1>
      <p className="text-muted-foreground">
        The all-time record book. Notable achievements across all seasons.
      </p>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
        {records.map((record) => {
          const Icon = iconMap[record.icon];
          return (
            <Card key={record.id} className="hover:shadow-md transition-shadow">
              <CardHeader className="pb-2">
                <div className="flex items-center gap-2">
                  <div className="flex h-8 w-8 items-center justify-center rounded-full bg-primary/10 text-primary">
                    <Icon className="h-4 w-4" />
                  </div>
                  <CardTitle className="text-base">{record.name}</CardTitle>
                </div>
              </CardHeader>
              <CardContent>
                <div className="space-y-1">
                  <div className="text-lg font-bold">{record.value}</div>
                  <div className="text-sm text-muted-foreground">
                    Held by <span className="font-medium text-foreground">{record.holder}</span>
                  </div>
                  <div className="text-xs text-muted-foreground">{record.date}</div>
                </div>
                <Button variant="ghost" size="sm" className="mt-3 -ml-2 text-xs">
                  View Details
                </Button>
              </CardContent>
            </Card>
          );
        })}
      </div>
    </div>
  );
}
