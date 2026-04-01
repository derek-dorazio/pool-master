import { Zap, ChevronRight } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
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

interface AutomatedEventCardProps {
  post: FeedPost;
}

export function AutomatedEventCard({ post }: AutomatedEventCardProps) {
  return (
    <div className="flex items-center gap-3 rounded-md bg-muted/50 px-4 py-3">
      <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-primary/10">
        <Zap className="h-4 w-4 text-primary" />
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <Badge variant="secondary" className="text-[10px] px-1.5">Event</Badge>
          <span className="text-[10px] text-muted-foreground">{formatRelative(post.createdAt)}</span>
        </div>
        <p className="text-sm">{post.content}</p>
      </div>
      <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />
    </div>
  );
}
