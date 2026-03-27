import { useParams } from 'react-router-dom';
import { FeedContainer } from '@/features/social/feed-container';

export function Component() {
  const { leagueId } = useParams<{ leagueId: string }>();

  return (
    <div className="space-y-6">
      <h1 className="text-3xl font-bold">League Activity Feed</h1>
      <FeedContainer leagueId={leagueId!} isCommissioner={false} />
    </div>
  );
}
