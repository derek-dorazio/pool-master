/**
 * Pre-draft/open state view for contest detail page.
 * Shows contest info, entry list, countdown to draft, and join CTA.
 */

import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { Users, Clock, Trophy, UserPlus, Check } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';

interface ContestInfo {
  id: string;
  name: string;
  sport: string;
  contestType: string;
  draftType: string;
  status: string;
  leagueName: string;
  leagueId: string;
  eventName?: string;
  startsAt?: string;
  lockAt?: string;
  maxEntries?: number;
  currentEntries: number;
  entryFee?: number;
  prizePool?: number;
  scoringEngine: string;
  isJoined: boolean;
  entries: Array<{ id: string; name: string; ownerName: string }>;
}

interface PreDraftViewProps {
  contest: ContestInfo;
  onJoin: () => void;
  isJoining: boolean;
}

function useCountdown(target: string | undefined) {
  const [timeLeft, setTimeLeft] = useState('');

  useEffect(() => {
    if (!target) return;
    const update = () => {
      const diff = new Date(target).getTime() - Date.now();
      if (diff <= 0) { setTimeLeft('Starting now'); return; }
      const d = Math.floor(diff / 86400000);
      const h = Math.floor((diff % 86400000) / 3600000);
      const m = Math.floor((diff % 3600000) / 60000);
      const parts: string[] = [];
      if (d > 0) parts.push(`${d}d`);
      if (h > 0) parts.push(`${h}h`);
      parts.push(`${m}m`);
      setTimeLeft(parts.join(' '));
    };
    update();
    const interval = setInterval(update, 60000);
    return () => clearInterval(interval);
  }, [target]);

  return timeLeft;
}

export function PreDraftView({ contest, onJoin, isJoining }: PreDraftViewProps) {
  const countdown = useCountdown(contest.startsAt);
  const lockCountdown = useCountdown(contest.lockAt);
  const spotsLeft = contest.maxEntries ? contest.maxEntries - contest.currentEntries : null;

  return (
    <div className="space-y-6">
      {/* Contest header */}
      <div>
        <div className="flex items-center gap-2 text-sm text-muted-foreground mb-1">
          <Link to={`/leagues/${contest.leagueId}`} className="hover:text-foreground">
            {contest.leagueName}
          </Link>
          {contest.eventName && (
            <><span>/</span><span>{contest.eventName}</span></>
          )}
        </div>
        <h1 className="text-2xl font-bold">{contest.name}</h1>
        <div className="flex items-center gap-3 mt-2">
          <Badge variant="outline">{contest.sport}</Badge>
          <Badge variant="outline">{contest.draftType}</Badge>
          <Badge className="bg-blue-100 text-blue-800">{contest.status}</Badge>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Main info */}
        <div className="lg:col-span-2 space-y-6">
          {/* Countdown card */}
          {contest.startsAt && (
            <Card className="border-primary/30">
              <CardContent className="py-6 text-center">
                <Clock className="h-8 w-8 text-primary mx-auto mb-2" />
                <p className="text-sm text-muted-foreground">Draft starts in</p>
                <p className="text-3xl font-bold font-mono mt-1">{countdown}</p>
                <p className="text-xs text-muted-foreground mt-2">
                  {new Date(contest.startsAt).toLocaleString(undefined, {
                    weekday: 'long', month: 'long', day: 'numeric', hour: 'numeric', minute: '2-digit',
                  })}
                </p>
              </CardContent>
            </Card>
          )}

          {/* Entry list */}
          <Card>
            <CardHeader>
              <div className="flex items-center justify-between">
                <CardTitle className="text-lg flex items-center gap-2">
                  <Users className="h-5 w-5" />
                  Entries ({contest.currentEntries}{contest.maxEntries ? ` / ${contest.maxEntries}` : ''})
                </CardTitle>
                {spotsLeft !== null && spotsLeft > 0 && (
                  <Badge variant="outline" className="text-green-700 border-green-300">
                    {spotsLeft} spot{spotsLeft !== 1 ? 's' : ''} left
                  </Badge>
                )}
              </div>
            </CardHeader>
            <CardContent>
              {contest.entries.length === 0 ? (
                <p className="text-sm text-muted-foreground text-center py-4">
                  No entries yet. Be the first to join!
                </p>
              ) : (
                <div className="space-y-2">
                  {contest.entries.map((entry, i) => (
                    <div key={entry.id} className="flex items-center justify-between py-1.5">
                      <div className="flex items-center gap-2">
                        <span className="text-xs text-muted-foreground w-5">{i + 1}.</span>
                        <span className="text-sm font-medium">{entry.name}</span>
                      </div>
                      <span className="text-xs text-muted-foreground">{entry.ownerName}</span>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </div>

        {/* Sidebar */}
        <div className="space-y-4">
          {/* Join CTA */}
          {!contest.isJoined ? (
            <Card className="border-primary">
              <CardContent className="py-6 text-center space-y-3">
                <Trophy className="h-8 w-8 text-primary mx-auto" />
                <p className="font-semibold">Join this contest</p>
                {contest.entryFee ? (
                  <p className="text-sm text-muted-foreground">Entry fee: ${(contest.entryFee / 100).toFixed(2)}</p>
                ) : (
                  <p className="text-sm text-muted-foreground">Free to enter</p>
                )}
                <Button className="w-full" onClick={onJoin} disabled={isJoining}>
                  <UserPlus className="h-4 w-4 mr-1" />
                  {isJoining ? 'Joining...' : 'Enter Contest'}
                </Button>
              </CardContent>
            </Card>
          ) : (
            <Card>
              <CardContent className="py-4 text-center">
                <Check className="h-6 w-6 text-green-600 mx-auto mb-1" />
                <p className="text-sm font-medium text-green-700">You're entered!</p>
                {contest.startsAt && (
                  <p className="text-xs text-muted-foreground mt-1">Draft room opens 5 min before start</p>
                )}
              </CardContent>
            </Card>
          )}

          {/* Contest details */}
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm">Contest Details</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2 text-sm">
              <div className="flex justify-between"><span className="text-muted-foreground">Type</span><span>{contest.contestType}</span></div>
              <Separator />
              <div className="flex justify-between"><span className="text-muted-foreground">Draft</span><span>{contest.draftType}</span></div>
              <Separator />
              <div className="flex justify-between"><span className="text-muted-foreground">Scoring</span><span>{contest.scoringEngine}</span></div>
              {contest.prizePool && (
                <><Separator /><div className="flex justify-between"><span className="text-muted-foreground">Prize Pool</span><span>${(contest.prizePool / 100).toFixed(2)}</span></div></>
              )}
              {contest.lockAt && (
                <><Separator /><div className="flex justify-between"><span className="text-muted-foreground">Locks in</span><span>{lockCountdown}</span></div></>
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
