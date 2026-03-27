import { Link } from 'react-router-dom';
import { Users, Trophy, Clock, UserPlus, Check, Loader2 } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import type { DiscoverableLeague, DiscoverableContest } from './hooks/use-discovery';

const sportEmoji: Record<string, string> = {
  GOLF: '\u26F3', NFL: '\uD83C\uDFC8', NBA: '\uD83C\uDFC0', F1: '\uD83C\uDFCE\uFE0F',
  NASCAR: '\uD83C\uDFCE\uFE0F', NCAA_BASKETBALL: '\uD83C\uDFC0', TENNIS: '\uD83C\uDFBE',
  HORSE_RACING: '\uD83C\uDFC7', SOCCER: '\u26BD', NHL: '\uD83C\uDFD2', MLB: '\u26BE', UFC: '\uD83E\uDD4A',
};

// --- League Card ---

interface LeagueCardProps {
  league: DiscoverableLeague;
  onJoin: () => void;
  isJoining: boolean;
  joinState?: 'none' | 'joined' | 'pending';
}

export function LeagueDiscoveryCard({ league, onJoin, isJoining, joinState = 'none' }: LeagueCardProps) {
  return (
    <Card className="hover:shadow-md transition-shadow">
      <CardContent className="p-4">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2 mb-1">
              <span className="text-lg">{sportEmoji[league.sport] ?? '\uD83C\uDFC6'}</span>
              <Link
                to={`/leagues/${league.id}`}
                className="text-sm font-semibold hover:text-primary truncate"
              >
                {league.name}
              </Link>
            </div>
            {league.description && (
              <p className="text-xs text-muted-foreground line-clamp-2 mb-2">{league.description}</p>
            )}
            <div className="flex items-center gap-3 text-xs text-muted-foreground">
              <span className="flex items-center gap-1">
                <Users className="h-3 w-3" />
                {league.memberCount}{league.maxMembers ? ` / ${league.maxMembers}` : ''} members
              </span>
              <span className="flex items-center gap-1">
                <Trophy className="h-3 w-3" />
                {league.activeContestCount} active
              </span>
            </div>
            <div className="flex items-center gap-2 mt-2">
              <Badge
                variant="outline"
                className={`text-[10px] ${league.joinPolicy === 'OPEN' ? 'text-green-700 border-green-300' : 'text-amber-700 border-amber-300'}`}
              >
                {league.joinPolicy === 'OPEN' ? 'Open' : 'Approval'}
              </Badge>
              <span className="text-[10px] text-muted-foreground">by {league.commissionerName}</span>
            </div>
          </div>

          <div className="shrink-0">
            {joinState === 'joined' ? (
              <Button size="sm" variant="outline" disabled className="h-8 text-xs">
                <Check className="h-3 w-3 mr-1" /> Joined
              </Button>
            ) : joinState === 'pending' ? (
              <Button size="sm" variant="outline" disabled className="h-8 text-xs">
                <Clock className="h-3 w-3 mr-1" /> Pending
              </Button>
            ) : (
              <Button size="sm" className="h-8 text-xs" onClick={onJoin} disabled={isJoining}>
                {isJoining ? (
                  <Loader2 className="h-3 w-3 animate-spin" />
                ) : (
                  <><UserPlus className="h-3 w-3 mr-1" /> {league.joinPolicy === 'OPEN' ? 'Join' : 'Request'}</>
                )}
              </Button>
            )}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

// --- Contest Card ---

interface ContestCardProps {
  contest: DiscoverableContest;
}

export function ContestDiscoveryCard({ contest }: ContestCardProps) {
  const lockDate = contest.lockTime ? new Date(contest.lockTime) : null;
  const daysUntilLock = lockDate ? Math.ceil((lockDate.getTime() - Date.now()) / (1000 * 60 * 60 * 24)) : null;

  return (
    <Card className="hover:shadow-md transition-shadow">
      <CardContent className="p-4">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2 mb-1">
              <span className="text-lg">{sportEmoji[contest.sport] ?? '\uD83C\uDFC6'}</span>
              <Link
                to={`/contests/${contest.id}`}
                className="text-sm font-semibold hover:text-primary truncate"
              >
                {contest.contestName}
              </Link>
            </div>
            <p className="text-xs text-muted-foreground mb-2">
              {contest.leagueName}
              {contest.eventName && <> &middot; {contest.eventName}</>}
            </p>
            <div className="flex items-center gap-3 text-xs text-muted-foreground">
              <span className="flex items-center gap-1">
                <Users className="h-3 w-3" />
                {contest.memberCount}{contest.maxMembers ? ` / ${contest.maxMembers}` : ''}
              </span>
              {contest.draftType && (
                <Badge variant="outline" className="text-[10px]">{contest.draftType}</Badge>
              )}
            </div>

            {/* Entry progress bar */}
            {contest.maxMembers && (
              <div className="mt-2">
                <div className="h-1.5 rounded-full bg-muted overflow-hidden">
                  <div
                    className="h-full bg-primary rounded-full transition-all"
                    style={{ width: `${(contest.memberCount / contest.maxMembers) * 100}%` }}
                  />
                </div>
              </div>
            )}
          </div>

          <div className="shrink-0 text-right">
            {daysUntilLock !== null && (
              <div className="flex items-center gap-1 text-xs">
                <Clock className="h-3 w-3 text-muted-foreground" />
                <span className={daysUntilLock <= 1 ? 'text-red-600 font-medium' : 'text-muted-foreground'}>
                  {daysUntilLock <= 0 ? 'Closing soon' : `${daysUntilLock}d left`}
                </span>
              </div>
            )}
            <Button size="sm" className="h-8 text-xs mt-2" asChild>
              <Link to={`/contests/${contest.id}`}>View</Link>
            </Button>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
