import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { useReplies, useCreateReply } from './hooks/use-feed';
import { ReactionBar } from './reaction-bar';
import { Send } from 'lucide-react';

function formatRelative(dateString: string): string {
  const diff = Date.now() - new Date(dateString).getTime();
  const m = Math.floor(diff / 60_000);
  if (m < 1) return 'just now';
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

interface ThreadViewProps {
  postId: string;
  leagueId: string;
}

export function ThreadView({ postId, leagueId }: ThreadViewProps) {
  const { data: replies, isLoading, isError, refetch } = useReplies(postId, leagueId, true);
  const createReply = useCreateReply(postId, leagueId);
  const [replyText, setReplyText] = useState('');

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!replyText.trim()) return;
    createReply.mutate(replyText.trim(), { onSuccess: () => setReplyText('') });
  }

  if (isLoading) {
    return (
      <div className="ml-8 mt-2 space-y-2 border-l-2 pl-4">
        <Skeleton className="h-8 w-full" />
        <Skeleton className="h-8 w-3/4" />
      </div>
    );
  }

  if (isError) {
    return (
      <div className="ml-8 mt-2 space-y-2 border-l-2 pl-4">
        <p role="alert" className="text-xs text-destructive">
          Couldn&apos;t load replies.
        </p>
        <Button variant="ghost" size="sm" className="h-8 px-2 text-xs" onClick={() => refetch()}>
          Try again
        </Button>
      </div>
    );
  }

  return (
    <div className="ml-8 mt-2 space-y-2 border-l-2 pl-4">
      {replies?.map((reply) => (
        <div key={reply.id} className="flex gap-2">
          <div className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-muted text-[10px] font-medium">
            {reply.authorInitials}
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <span className="text-xs font-medium">{reply.authorName}</span>
              <span className="text-[10px] text-muted-foreground">{formatRelative(reply.createdAt)}</span>
            </div>
            <p className="text-xs">{reply.content}</p>
            {reply.reactions.length > 0 && <ReactionBar reactions={reply.reactions} onToggle={() => {}} />}
          </div>
        </div>
      ))}

      <form onSubmit={handleSubmit} className="flex gap-2">
        <Input
          value={replyText}
          onChange={(e) => setReplyText(e.target.value)}
          placeholder="Write a reply..."
          className="h-8 text-xs"
          maxLength={500}
        />
        <Button type="submit" size="sm" variant="ghost" disabled={!replyText.trim() || createReply.isPending}>
          <Send className="h-3 w-3" />
        </Button>
      </form>
    </div>
  );
}
