import { DraftQueue } from '../../../packages/core-api/src/modules/drafts/engine/draft-queue';

describe('DraftQueue', () => {
  let queue: DraftQueue;

  beforeEach(() => {
    queue = new DraftQueue();
  });

  it('sets and retrieves a queue (defensive copy)', () => {
    const ids = ['p1', 'p2', 'p3'];
    queue.setQueue('entry-a', ids);

    // Mutate original — should not affect stored queue
    ids.push('p4');
    expect(queue.getQueue('entry-a')).toEqual(['p1', 'p2', 'p3']);
  });

  it('returns empty array for missing queue', () => {
    expect(queue.getQueue('nonexistent')).toEqual([]);
  });

  it('getNextAvailable skips already-drafted participants', () => {
    queue.setQueue('entry-a', ['p1', 'p2', 'p3']);
    const drafted = new Set(['p1', 'p3']);
    expect(queue.getNextAvailable('entry-a', drafted)).toBe('p2');
  });

  it('getNextAvailable returns null when all queued are drafted', () => {
    queue.setQueue('entry-a', ['p1', 'p2']);
    const drafted = new Set(['p1', 'p2']);
    expect(queue.getNextAvailable('entry-a', drafted)).toBeNull();
  });

  it('getNextAvailable returns null for missing entry', () => {
    expect(queue.getNextAvailable('nope', new Set())).toBeNull();
  });

  it('removeFromAllQueues removes participant across all entries', () => {
    queue.setQueue('entry-a', ['p1', 'p2', 'p3']);
    queue.setQueue('entry-b', ['p2', 'p4']);

    queue.removeFromAllQueues('p2');

    expect(queue.getQueue('entry-a')).toEqual(['p1', 'p3']);
    expect(queue.getQueue('entry-b')).toEqual(['p4']);
  });

  it('reorder moves an item forward', () => {
    queue.setQueue('entry-a', ['p1', 'p2', 'p3', 'p4']);
    queue.reorder('entry-a', 3, 1); // move p4 from index 3 to index 1
    expect(queue.getQueue('entry-a')).toEqual(['p1', 'p4', 'p2', 'p3']);
  });

  it('reorder is a no-op for out-of-range indices', () => {
    queue.setQueue('entry-a', ['p1', 'p2']);
    queue.reorder('entry-a', -1, 0);
    queue.reorder('entry-a', 0, 5);
    expect(queue.getQueue('entry-a')).toEqual(['p1', 'p2']);
  });

  it('addToQueue appends if not present, skips if duplicate', () => {
    queue.setQueue('entry-a', ['p1']);
    queue.addToQueue('entry-a', 'p2');
    queue.addToQueue('entry-a', 'p1'); // already present
    expect(queue.getQueue('entry-a')).toEqual(['p1', 'p2']);
  });

  it('removeFromQueue removes a single participant from one entry', () => {
    queue.setQueue('entry-a', ['p1', 'p2', 'p3']);
    queue.removeFromQueue('entry-a', 'p2');
    expect(queue.getQueue('entry-a')).toEqual(['p1', 'p3']);
  });

  it('hasQueue returns false for empty or missing queue', () => {
    expect(queue.hasQueue('entry-a')).toBe(false);
    queue.setQueue('entry-a', []);
    expect(queue.hasQueue('entry-a')).toBe(false);
    queue.setQueue('entry-a', ['p1']);
    expect(queue.hasQueue('entry-a')).toBe(true);
  });

  it('clearAll removes all queues', () => {
    queue.setQueue('entry-a', ['p1']);
    queue.setQueue('entry-b', ['p2']);
    queue.clearAll();
    expect(queue.hasQueue('entry-a')).toBe(false);
    expect(queue.hasQueue('entry-b')).toBe(false);
  });
});
