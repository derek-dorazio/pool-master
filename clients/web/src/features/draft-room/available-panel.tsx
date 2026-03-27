import { useState } from 'react';
import { Search, X, ChevronDown, AlertCircle } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { useAvailableParticipants, type AvailableParticipant } from './hooks/use-draft';

interface AvailablePanelProps {
  draftId: string;
  onDraft: (participantId: string) => void;
  onSelect: (participant: AvailableParticipant) => void;
  isDrafting: boolean;
  isMyPick: boolean;
}

const POSITIONS = ['QB', 'RB', 'WR', 'TE', 'K', 'DEF'];

export function AvailablePanel({ draftId, onDraft, onSelect, isDrafting, isMyPick }: AvailablePanelProps) {
  const [query, setQuery] = useState('');
  const [position, setPosition] = useState<string>('');
  const [sort, setSort] = useState('ranking');
  const [showFilters, setShowFilters] = useState(false);

  const { data: participants, isLoading } = useAvailableParticipants(draftId, {
    query: query || undefined,
    position: position || undefined,
    sort,
  });

  return (
    <div className="flex flex-col h-full border-r">
      <div className="p-3 border-b space-y-2">
        <div className="relative">
          <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Search players..."
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            className="pl-9 pr-8 h-9"
          />
          {query && (
            <button onClick={() => setQuery('')} className="absolute right-2.5 top-2.5">
              <X className="h-4 w-4 text-muted-foreground" />
            </button>
          )}
        </div>

        <button
          onClick={() => setShowFilters(!showFilters)}
          className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
        >
          <ChevronDown className={`h-3 w-3 transition-transform ${showFilters ? 'rotate-180' : ''}`} />
          Filters
        </button>

        {showFilters && (
          <div className="space-y-2">
            <div className="flex flex-wrap gap-1">
              <Badge
                variant={position === '' ? 'default' : 'outline'}
                className="cursor-pointer text-xs"
                onClick={() => setPosition('')}
              >
                All
              </Badge>
              {POSITIONS.map((pos) => (
                <Badge
                  key={pos}
                  variant={position === pos ? 'default' : 'outline'}
                  className="cursor-pointer text-xs"
                  onClick={() => setPosition(pos === position ? '' : pos)}
                >
                  {pos}
                </Badge>
              ))}
            </div>
            <select
              value={sort}
              onChange={(e) => setSort(e.target.value)}
              className="w-full h-8 rounded-md border bg-background px-2 text-xs"
            >
              <option value="ranking">Sort: Ranking</option>
              <option value="name">Sort: Name</option>
              <option value="form">Sort: Form Rating</option>
            </select>
          </div>
        )}

        <p className="text-xs text-muted-foreground">
          {participants?.length ?? 0} available
        </p>
      </div>

      <div className="flex-1 overflow-y-auto">
        {isLoading ? (
          <div className="p-3 space-y-2">
            {Array.from({ length: 8 }).map((_, i) => (
              <div key={i} className="h-16 rounded-md bg-muted animate-pulse" />
            ))}
          </div>
        ) : (
          <div className="divide-y">
            {participants?.map((p) => (
              <ParticipantRow
                key={p.id}
                participant={p}
                onDraft={() => onDraft(p.id)}
                onSelect={() => onSelect(p)}
                canDraft={isMyPick && !isDrafting}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function ParticipantRow({
  participant,
  onDraft,
  onSelect,
  canDraft,
}: {
  participant: AvailableParticipant;
  onDraft: () => void;
  onSelect: () => void;
  canDraft: boolean;
}) {
  const isInjured = participant.injuryStatus !== 'HEALTHY';

  return (
    <div
      className="flex items-center justify-between px-3 py-2 hover:bg-accent transition-colors cursor-pointer group"
      onClick={onSelect}
    >
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="text-sm font-medium truncate">{participant.name}</span>
          {isInjured && (
            <AlertCircle className="h-3.5 w-3.5 text-orange-500 shrink-0" />
          )}
        </div>
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          {participant.position && (
            <Badge variant="outline" className="text-[10px] px-1 py-0">{participant.position}</Badge>
          )}
          <span>{participant.team}</span>
          <span>#{participant.ranking}</span>
          <span>Form: {participant.formRating.toFixed(1)}</span>
        </div>
      </div>
      {canDraft && (
        <Button
          size="sm"
          variant="outline"
          className="opacity-0 group-hover:opacity-100 transition-opacity shrink-0 ml-2 h-7 text-xs"
          onClick={(e) => { e.stopPropagation(); onDraft(); }}
        >
          Draft
        </Button>
      )}
    </div>
  );
}
