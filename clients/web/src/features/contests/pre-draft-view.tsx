/**
 * Pre-draft/open state view for contest detail page.
 * Shows contest info, entry list, countdown to draft, and join CTA.
 */

import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { Users, Clock, Trophy, UserPlus, Check } from 'lucide-react';
import {
  ContestStatus,
  ScoringEngine,
  SelectionType,
  type SelectionType as SelectionTypeValue,
  type ScoringEngine as ScoringEngineValue,
} from '@poolmaster/shared/domain';
import type { ContestDetailDto } from '@poolmaster/shared/dto';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';

interface ContestEntrySummary {
  id: string;
  name: string;
  ownerName?: string;
}

interface EntryMeta {
  currentEntries?: number;
  maxEntries?: number;
  entries?: ContestEntrySummary[];
}

interface JoinMeta {
  isJoined?: boolean;
  entryFeeCents?: number | null;
  prizePoolCents?: number | null;
}

interface PreDraftViewProps {
  contest: ContestDetailDto;
  selectionConfig?: Record<string, unknown> | null;
  league?: {
    id: string;
    name: string;
  } | null;
  eventName?: string;
  entryMeta?: EntryMeta;
  joinMeta?: JoinMeta;
  onJoin?: () => void;
  isJoining?: boolean;
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

function formatSelectionType(selectionType: string) {
  const labels: Record<SelectionTypeValue, string> = {
    [SelectionType.SNAKE_DRAFT]: 'Snake Draft',
    [SelectionType.TIERED]: 'Tiered Pick',
    [SelectionType.BUDGET_PICK]: 'Budget Pick',
    [SelectionType.OPEN_SELECTION]: 'Open Selection',
    [SelectionType.PICK_EM]: "Pick'em",
    [SelectionType.BRACKET_PICK_EM]: "Bracket Pick'em",
  };

  return labels[selectionType as SelectionTypeValue] ?? selectionType;
}

function getRoomReadyLabel(selectionType: string) {
  if (selectionType === SelectionType.SNAKE_DRAFT) {
    return 'Draft room opens 5 min before start';
  }
  return 'Entry room opens 5 min before start';
}

function formatScoringEngine(scoringEngine: string) {
  const labels: Record<ScoringEngineValue, string> = {
    [ScoringEngine.ADVANCEMENT]: 'Advancement',
    [ScoringEngine.STAT_ACCUMULATION]: 'Stat Accumulation',
    [ScoringEngine.STROKE_PLAY]: 'Stroke Play',
    [ScoringEngine.POSITION]: 'Position',
    [ScoringEngine.BRACKET]: 'Bracket',
    [ScoringEngine.FIGHT_RESULT]: 'Fight Result',
    [ScoringEngine.CUMULATIVE]: 'Cumulative',
  };

  return labels[scoringEngine as ScoringEngineValue] ?? scoringEngine;
}

function formatStatus(status: string) {
  if (status === ContestStatus.DRAFTING) return 'Drafting';
  if (status === ContestStatus.DRAFT) return 'Draft Setup';
  if (status === ContestStatus.OPEN) return 'Open';
  if (status === ContestStatus.LOCKED) return 'Locked';
  if (status === ContestStatus.ACTIVE) return 'In Progress';
  if (status === ContestStatus.COMPLETED) return 'Completed';
  if (status === ContestStatus.CANCELLED) return 'Cancelled';
  return status;
}

function getSelectionDetailRows(selectionConfig: Record<string, unknown> | null | undefined) {
  if (!selectionConfig) return [];

  const rows: Array<{ label: string; value: string }> = [];

  const draftMode = typeof selectionConfig.draftMode === 'string' ? selectionConfig.draftMode : null;
  if (draftMode) {
    rows.push({ label: 'Draft Mode', value: draftMode });
  }

  const rounds = typeof selectionConfig.rounds === 'number' ? selectionConfig.rounds : null;
  if (rounds) {
    rows.push({ label: 'Rounds', value: `${rounds}` });
  }

  const budget = typeof selectionConfig.budget === 'number' ? selectionConfig.budget : null;
  if (budget) {
    rows.push({ label: 'Budget', value: `$${budget.toLocaleString()}` });
  }

  const rosterSize = typeof selectionConfig.rosterSize === 'number' ? selectionConfig.rosterSize : null;
  if (rosterSize) {
    rows.push({ label: 'Roster Size', value: `${rosterSize}` });
  }

  const pickCount = typeof selectionConfig.pickCount === 'number' ? selectionConfig.pickCount : null;
  if (pickCount) {
    rows.push({ label: 'Pick Count', value: `${pickCount}` });
  }

  const bestBallN = typeof selectionConfig.bestBallN === 'number' ? selectionConfig.bestBallN : null;
  if (bestBallN) {
    rows.push({ label: 'Best Ball', value: `Best ${bestBallN} count` });
  }

  const survivorStyle = typeof selectionConfig.survivorStyle === 'string' ? selectionConfig.survivorStyle : null;
  if (survivorStyle) {
    rows.push({ label: 'Survivor Style', value: survivorStyle });
  }

  return rows;
}

export function PreDraftView({
  contest,
  selectionConfig = null,
  league = null,
  eventName,
  entryMeta,
  joinMeta,
  onJoin,
  isJoining = false,
}: PreDraftViewProps) {
  const countdown = useCountdown(contest.startsAt ?? undefined);
  const lockCountdown = useCountdown(contest.lockAt ?? undefined);
  const currentEntries = entryMeta?.currentEntries ?? contest.entryCount ?? 0;
  const maxEntries = entryMeta?.maxEntries ?? null;
  const spotsLeft = maxEntries !== null ? maxEntries - currentEntries : null;
  const entries = entryMeta?.entries ?? [];
  const isJoined = joinMeta?.isJoined ?? false;
  const selectionDetailRows = getSelectionDetailRows(selectionConfig);
  const showJoinCta = !isJoined && !!onJoin;

  return (
    <div className="space-y-6">
      {/* Contest header */}
      <div>
        <div className="flex items-center gap-2 text-sm text-muted-foreground mb-1">
          {league ? (
            <Link to={`/leagues/${league.id}`} className="hover:text-foreground">
              {league.name}
            </Link>
          ) : (
            <span>League</span>
          )}
          {eventName && (
            <><span>/</span><span>{eventName}</span></>
          )}
        </div>
        <h1 className="text-2xl font-bold">{contest.name}</h1>
        <div className="flex items-center gap-3 mt-2">
          {contest.sport && <Badge variant="outline">{contest.sport}</Badge>}
          <Badge variant="outline">{formatSelectionType(contest.selectionType)}</Badge>
          <Badge className="bg-blue-100 text-blue-800">{formatStatus(contest.status)}</Badge>
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
                  Entries ({currentEntries}{maxEntries ? ` / ${maxEntries}` : ''})
                </CardTitle>
                {spotsLeft !== null && spotsLeft > 0 && (
                  <Badge variant="outline" className="text-green-700 border-green-300">
                    {spotsLeft} spot{spotsLeft !== 1 ? 's' : ''} left
                  </Badge>
                )}
              </div>
            </CardHeader>
            <CardContent>
              {entries.length === 0 ? (
                <p className="text-sm text-muted-foreground text-center py-4">
                  No entry roster is available from this view yet.
                </p>
              ) : (
                <div className="space-y-2">
                  {entries.map((entry, i) => (
                    <div key={entry.id} className="flex items-center justify-between py-1.5">
                      <div className="flex items-center gap-2">
                        <span className="text-xs text-muted-foreground w-5">{i + 1}.</span>
                        <span className="text-sm font-medium">{entry.name}</span>
                      </div>
                      <span className="text-xs text-muted-foreground">{entry.ownerName ?? 'Manager unavailable'}</span>
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
          {showJoinCta ? (
            <Card className="border-primary">
              <CardContent className="py-6 text-center space-y-3">
                <Trophy className="h-8 w-8 text-primary mx-auto" />
                <p className="font-semibold">Join this contest</p>
                {joinMeta?.entryFeeCents ? (
                  <p className="text-sm text-muted-foreground">Entry fee: ${(joinMeta.entryFeeCents / 100).toFixed(2)}</p>
                ) : (
                  <p className="text-sm text-muted-foreground">Free to enter</p>
                )}
                <Button className="w-full" onClick={onJoin} disabled={isJoining}>
                  <UserPlus className="h-4 w-4 mr-1" />
                  {isJoining ? 'Joining...' : 'Enter Contest'}
                </Button>
              </CardContent>
            </Card>
          ) : isJoined ? (
            <Card>
              <CardContent className="py-4 text-center">
                <Check className="h-6 w-6 text-green-600 mx-auto mb-1" />
                <p className="text-sm font-medium text-green-700">You're entered!</p>
                {contest.startsAt && (
                  <p className="text-xs text-muted-foreground mt-1">{getRoomReadyLabel(contest.selectionType)}</p>
                )}
              </CardContent>
            </Card>
          ) : null}

          {/* Contest details */}
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm">Contest Details</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2 text-sm">
              <div className="flex justify-between"><span className="text-muted-foreground">Type</span><span>{contest.contestType}</span></div>
              <Separator />
              <div className="flex justify-between"><span className="text-muted-foreground">Selection</span><span>{formatSelectionType(contest.selectionType)}</span></div>
              <Separator />
              <div className="flex justify-between"><span className="text-muted-foreground">Scoring</span><span>{formatScoringEngine(contest.scoringEngine)}</span></div>
              {selectionDetailRows.map((row) => (
                <div key={row.label}>
                  <Separator />
                  <div className="flex justify-between"><span className="text-muted-foreground">{row.label}</span><span>{row.value}</span></div>
                </div>
              ))}
              {joinMeta?.prizePoolCents && (
                <><Separator /><div className="flex justify-between"><span className="text-muted-foreground">Prize Pool</span><span>${(joinMeta.prizePoolCents / 100).toFixed(2)}</span></div></>
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
