import { useEffect, useRef } from 'react';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { PostCard } from './post-card';
import { ComposeBox } from './compose-box';
import {
  useFeed,
  useCreatePost,
  useToggleReaction,
  usePinPost,
  useDeletePost,
} from './hooks/use-feed';

interface FeedContainerProps {
  leagueId: string;
  isCommissioner?: boolean;
}

export function FeedContainer({ leagueId, isCommissioner }: FeedContainerProps) {
  const { data, isLoading, isError, fetchNextPage, hasNextPage, isFetchingNextPage, refetch } = useFeed(leagueId);
  const createPost = useCreatePost(leagueId);
  const toggleReaction = useToggleReaction(leagueId);
  const pinPost = usePinPost(leagueId);
  const deletePost = useDeletePost(leagueId);
  const sentinelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = sentinelRef.current;
    if (!el || !hasNextPage) return;
    if (typeof IntersectionObserver === 'undefined') return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0].isIntersecting) fetchNextPage();
      },
      { rootMargin: '200px' },
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, [hasNextPage, fetchNextPage]);

  if (isLoading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-24 w-full" />
        <Skeleton className="h-32 w-full" />
        <Skeleton className="h-32 w-full" />
        <Skeleton className="h-20 w-full" />
      </div>
    );
  }

  if (isError) {
    return (
      <div className="flex flex-col items-center py-12 text-center">
        <p className="text-sm text-muted-foreground">Couldn't load feed</p>
        <Button variant="ghost" size="sm" className="mt-2" onClick={() => refetch()}>Try again</Button>
      </div>
    );
  }

  const pinnedPosts = data?.pages[0]?.pinned ?? [];
  const allPosts = data?.pages.flatMap((p) => p.items) ?? [];

  return (
    <div className="space-y-4" role="feed" aria-busy={isLoading || isFetchingNextPage} data-testid="league-feed">
      {/* Pinned posts */}
      {pinnedPosts.map((post) => (
        <PostCard
          key={post.id}
          post={post}
          leagueId={leagueId}
          isCommissioner={isCommissioner}
          onReaction={(postId, emoji) => toggleReaction.mutate({ postId, emoji })}
          onPin={(postId, pin) => pinPost.mutate({ postId, pin })}
          onDelete={(postId) => deletePost.mutate(postId)}
        />
      ))}

      {/* Compose box */}
      <ComposeBox
        onSubmit={(d) => createPost.mutate(d)}
        isPending={createPost.isPending}
      />

      {/* Feed items */}
      {allPosts.map((post) => (
        <PostCard
          key={post.id}
          post={post}
          leagueId={leagueId}
          isCommissioner={isCommissioner}
          onReaction={(postId, emoji) => toggleReaction.mutate({ postId, emoji })}
          onPin={(postId, pin) => pinPost.mutate({ postId, pin })}
          onDelete={(postId) => deletePost.mutate(postId)}
        />
      ))}

      {allPosts.length === 0 && (
        <div className="py-12 text-center">
          <p className="text-sm text-muted-foreground">No posts yet. Be the first to share something!</p>
        </div>
      )}

      <div ref={sentinelRef} />

      {isFetchingNextPage && (
        <div className="flex justify-center py-4">
          <div className="h-5 w-5 animate-spin rounded-full border-2 border-primary border-t-transparent" />
        </div>
      )}
    </div>
  );
}
