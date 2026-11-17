import { X } from 'lucide-react';
import { Text, Tile, TrophyMark } from '@/features/shared/ui';
import type { BracketChampion } from './bracket-view-model';

/**
 * The entry's champion (#1753, option A): our drawn trophy, "Your champion" and the team. The
 * bracket around it already shows the team's seed and region. Once the team is out the trophy
 * greys and the name is struck through in red. The middle of a desktop bracket, a phone's Final
 * Four tab, the pick page once a champion is picked, and the bracket dialog all show it.
 */
export function BracketChampionCard({ champion, isOwnEntry }: { champion: BracketChampion; isOwnEntry: boolean }) {
  return (
    <Tile
      className="flex flex-col items-center gap-1 text-center"
      data-out={champion.isOut || undefined}
      data-testid="bracket-champion"
      padding="sm"
    >
      <TrophyMark isOut={champion.isOut} />
      <Text variant="label">{isOwnEntry ? 'Your champion' : 'Champion'}</Text>
      <Text
        className={champion.isOut ? 'inline-flex items-center gap-1 line-through' : undefined}
        data-testid="bracket-champion-name"
        size="lg"
        tone={champion.isOut ? 'danger' : 'default'}
        variant="display"
      >
        {champion.isOut ? <X aria-label="Out" size={16} strokeWidth={3} /> : null}
        {champion.team.name}
      </Text>
    </Tile>
  );
}
