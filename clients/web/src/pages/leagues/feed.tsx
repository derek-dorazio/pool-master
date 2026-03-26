import { useState } from 'react';
import { useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { ThumbsUp, Pin, Send, Zap } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import {
  Card,
  CardContent,
} from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';

interface FeedItem {
  id: string;
  type: 'post' | 'event' | 'announcement';
  author: string;
  authorInitials: string;
  content: string;
  timestamp: string;
  likes: number;
  pinned?: boolean;
}

const mockFeed: FeedItem[] = [
  {
    id: 'f1',
    type: 'announcement',
    author: 'Mike Johnson',
    authorInitials: 'MJ',
    content: 'Playoff contest is live! Draft starts this Saturday at 6 PM EST. Make sure your roster is ready.',
    timestamp: '1 hour ago',
    likes: 5,
    pinned: true,
  },
  {
    id: 'f2',
    type: 'post',
    author: 'Sarah Kim',
    authorInitials: 'SK',
    content: 'Anyone else nervous about their Week 14 picks? I went all-in on underdogs this week.',
    timestamp: '3 hours ago',
    likes: 3,
  },
  {
    id: 'f3',
    type: 'event',
    author: 'System',
    authorInitials: 'PM',
    content: 'Draft completed — all picks are in! Check the results in the contest page.',
    timestamp: '1 day ago',
    likes: 8,
  },
  {
    id: 'f4',
    type: 'post',
    author: 'Dan Miller',
    authorInitials: 'DM',
    content: 'Great week for my picks! Finally cracked the top 3 in standings.',
    timestamp: '2 days ago',
    likes: 2,
  },
  {
    id: 'f5',
    type: 'event',
    author: 'System',
    authorInitials: 'PM',
    content: 'Week 13 results are in. Sarah K. takes the weekly crown with 14/16 correct picks!',
    timestamp: '4 days ago',
    likes: 6,
  },
];

function useFeed(leagueId: string) {
  return useQuery({
    queryKey: ['league-feed', leagueId],
    queryFn: async () => mockFeed,
    initialData: mockFeed,
  });
}

function FeedPost({ item }: { item: FeedItem }) {
  const [liked, setLiked] = useState(false);
  const likeCount = liked ? item.likes + 1 : item.likes;

  return (
    <Card
      className={cn(
        item.pinned && 'border-amber-200 bg-amber-50/50',
      )}
    >
      <CardContent className="p-4">
        {item.pinned && (
          <div className="flex items-center gap-1 text-xs text-amber-600 mb-2">
            <Pin className="h-3 w-3" />
            Pinned by commissioner
          </div>
        )}
        <div className="flex gap-3">
          <div
            className={cn(
              'flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-sm font-medium',
              item.type === 'event'
                ? 'bg-primary/10 text-primary'
                : item.type === 'announcement'
                  ? 'bg-amber-100 text-amber-700'
                  : 'bg-muted',
            )}
          >
            {item.type === 'event' ? (
              <Zap className="h-4 w-4" />
            ) : (
              item.authorInitials
            )}
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 mb-1">
              <span className="font-medium text-sm">{item.author}</span>
              {item.type === 'announcement' && (
                <Badge className="bg-amber-100 text-amber-800 border-amber-200 text-[10px] px-1.5">
                  Announcement
                </Badge>
              )}
              {item.type === 'event' && (
                <Badge variant="secondary" className="text-[10px] px-1.5">
                  Event
                </Badge>
              )}
              <span className="text-xs text-muted-foreground">{item.timestamp}</span>
            </div>
            <p className="text-sm">{item.content}</p>
            <button
              onClick={() => setLiked(!liked)}
              className={cn(
                'mt-2 flex items-center gap-1 text-xs transition-colors',
                liked
                  ? 'text-primary font-medium'
                  : 'text-muted-foreground hover:text-foreground',
              )}
            >
              <ThumbsUp className="h-3.5 w-3.5" />
              {likeCount}
            </button>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

export function Component() {
  const { leagueId } = useParams<{ leagueId: string }>();
  const { data: feed = [] } = useFeed(leagueId!);
  const [postContent, setPostContent] = useState('');

  return (
    <div className="space-y-6">
      <h1 className="text-3xl font-bold">League Feed</h1>

      {/* Compose box */}
      <Card>
        <CardContent className="p-4">
          <Textarea
            placeholder="Share something with your league..."
            value={postContent}
            onChange={(e) => setPostContent(e.target.value)}
            rows={3}
          />
          <div className="flex justify-end mt-3">
            <Button size="sm" disabled={!postContent.trim()}>
              <Send className="h-4 w-4 mr-1" />
              Post
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Feed items */}
      <div className="space-y-3">
        {feed.map((item) => (
          <FeedPost key={item.id} item={item} />
        ))}
      </div>
    </div>
  );
}
