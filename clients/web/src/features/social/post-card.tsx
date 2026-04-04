import { useState } from 'react';
import { Pin, Trash2, MoreHorizontal } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { ReactionBar } from './reaction-bar';
import { PollCard } from './poll-card';
import { ThreadView } from './thread-view';
import { AutomatedEventCard } from './automated-event-card';
import type { FeedPost } from './hooks/use-feed';

function formatRelative(dateString: string): string {
  const diff = Date.now() - new Date(dateString).getTime();
  const m = Math.floor(diff / 60_000);
  if (m < 1) return 'just now';
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

interface PostCardProps {
  post: FeedPost;
  leagueId: string;
  isCommissioner?: boolean;
  onReaction: (postId: string, emoji: string) => void;
  onPin?: (postId: string, pin: boolean) => void;
  onDelete?: (postId: string) => void;
  onVotePoll?: (postId: string, optionId: string) => void;
}

export function PostCard({
  post,
  leagueId,
  isCommissioner,
  onReaction,
  onPin,
  onDelete,
  onVotePoll,
}: PostCardProps) {
  const [showThread, setShowThread] = useState(false);
  const [showMenu, setShowMenu] = useState(false);

  if (post.type === 'event') {
    return <AutomatedEventCard post={post} />;
  }

  const isAnnouncement = post.type === 'announcement';

  return (
    <Card className={cn(post.pinned && 'border-l-4 border-l-primary')}>
      <CardContent className="p-4">
        {post.pinned && post.pinnedBy && (
          <div className="mb-2 flex items-center gap-1 text-xs text-primary">
            <Pin className="h-3 w-3" />
            Pinned by {post.pinnedBy}
          </div>
        )}

        <div className="group flex gap-3">
          <div
            className={cn(
              'flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-sm font-medium',
              isAnnouncement ? 'bg-amber-100 text-amber-700' : 'bg-muted',
            )}
          >
            {post.authorInitials}
          </div>

          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <span className="text-sm font-medium">{post.authorName}</span>
              {isAnnouncement && (
                <Badge className="bg-amber-100 text-amber-800 border-amber-200 text-[10px] px-1.5">
                  Announcement
                </Badge>
              )}
              <span className="text-xs text-muted-foreground" title={new Date(post.createdAt).toLocaleString()}>
                {formatRelative(post.createdAt)}
              </span>

              {isCommissioner && (
                <div className="relative ml-auto">
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="h-6 w-6 p-0"
                    aria-haspopup="menu"
                    aria-expanded={showMenu}
                    onClick={() => setShowMenu(!showMenu)}
                  >
                    <MoreHorizontal className="h-4 w-4" />
                  </Button>
                  {showMenu && (
                    <div className="absolute right-0 top-full z-10 mt-1 w-36 rounded-md border bg-card py-1 shadow-lg">
                      <button
                        type="button"
                        className="flex w-full items-center gap-2 px-3 py-1.5 text-sm hover:bg-accent"
                        onClick={() => { onPin?.(post.id, !post.pinned); setShowMenu(false); }}
                      >
                        <Pin className="h-3 w-3" />
                        {post.pinned ? 'Unpin' : 'Pin'}
                      </button>
                      <button
                        type="button"
                        className="flex w-full items-center gap-2 px-3 py-1.5 text-sm text-destructive hover:bg-accent"
                        onClick={() => { onDelete?.(post.id); setShowMenu(false); }}
                      >
                        <Trash2 className="h-3 w-3" />
                        Delete
                      </button>
                    </div>
                  )}
                </div>
              )}
            </div>

            <p className="mt-1 text-sm whitespace-pre-wrap">{post.content}</p>

            {post.poll && onVotePoll && (
              <PollCard poll={post.poll} onVote={(optionId) => onVotePoll(post.id, optionId)} />
            )}

            <div className="mt-2 flex items-center gap-3">
              <ReactionBar reactions={post.reactions} onToggle={(emoji) => onReaction(post.id, emoji)} />
              {post.replyCount > 0 && (
                <button
                  type="button"
                  className="text-xs text-muted-foreground hover:text-foreground transition-colors"
                  onClick={() => setShowThread(!showThread)}
                  aria-expanded={showThread}
                >
                  {post.replyCount} {post.replyCount === 1 ? 'reply' : 'replies'}
                </button>
              )}
            </div>

            {showThread && <ThreadView postId={post.id} leagueId={leagueId} />}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
