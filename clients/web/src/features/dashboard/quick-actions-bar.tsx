import { Link } from 'react-router-dom';
import { Plus, Search, Zap } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useMyLeagues } from './hooks/use-my-leagues';

export function QuickActionsBar() {
  const { data: leagues } = useMyLeagues();
  const hasCommissionerLeague = leagues?.some((l) => l.role === 'Commissioner');

  return (
    <div className="flex flex-wrap items-center gap-2">
      <Button asChild variant="outline" size="sm">
        <Link to="/leagues/create">
          <Plus className="h-4 w-4 mr-1" />
          Create League
        </Link>
      </Button>
      <Button asChild variant="outline" size="sm">
        <Link to="/discover/leagues">
          <Search className="h-4 w-4 mr-1" />
          Join League
        </Link>
      </Button>
      <Button asChild variant="outline" size="sm">
        <Link to="/discover/contests">
          <Zap className="h-4 w-4 mr-1" />
          Browse Contests
        </Link>
      </Button>
      {hasCommissionerLeague && (
        <Button asChild variant="outline" size="sm">
          <Link to="/contests/create">
            <Plus className="h-4 w-4 mr-1" />
            Create Contest
          </Link>
        </Button>
      )}
    </div>
  );
}
