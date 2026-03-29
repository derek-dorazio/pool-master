import { EventGrouper } from '../../../packages/core-api/src/modules/notifications/core/event-grouper';

describe('EventGrouper', () => {
  let grouper: EventGrouper;

  beforeEach(() => {
    grouper = new EventGrouper();
  });

  it('identifies groupable event types', () => {
    expect(grouper.isGroupable('scoring.position_change')).toBe(true);
    expect(grouper.isGroupable('draft.pick_made')).toBe(true);
    expect(grouper.isGroupable('draft.on_the_clock')).toBe(false);
    expect(grouper.isGroupable('contest.you_won')).toBe(false);
  });

  it('buffers events and returns null until window closes', () => {
    const result = grouper.add({
      id: '1',
      type: 'scoring.position_change',
      userId: 'user1',
      data: { contest_name: 'Masters', position: 3 },
      timestamp: new Date(),
    });

    expect(result).toBeNull();
  });

  it('flushes user events on demand', () => {
    grouper.add({
      id: '1',
      type: 'scoring.position_change',
      userId: 'user1',
      data: { contest_name: 'Masters', position: 3 },
      timestamp: new Date(),
    });

    grouper.add({
      id: '2',
      type: 'scoring.position_change',
      userId: 'user1',
      data: { contest_name: 'Masters', position: 5 },
      timestamp: new Date(),
    });

    const results = grouper.flushUser('user1');
    expect(results).toHaveLength(1);
    expect(results[0].count).toBe(2);
    expect(results[0].eventType).toBe('scoring.position_change');
    expect(results[0].userId).toBe('user1');
  });

  it('isolates events between users', () => {
    grouper.add({
      id: '1',
      type: 'scoring.position_change',
      userId: 'user1',
      data: { position: 1 },
      timestamp: new Date(),
    });

    grouper.add({
      id: '2',
      type: 'scoring.position_change',
      userId: 'user2',
      data: { position: 5 },
      timestamp: new Date(),
    });

    const user1Results = grouper.flushUser('user1');
    const user2Results = grouper.flushUser('user2');

    expect(user1Results).toHaveLength(1);
    expect(user1Results[0].count).toBe(1);
    expect(user2Results).toHaveLength(1);
    expect(user2Results[0].count).toBe(1);
  });

  it('returns non-groupable events as null', () => {
    const result = grouper.add({
      id: '1',
      type: 'contest.you_won',
      userId: 'user1',
      data: {},
      timestamp: new Date(),
    });
    expect(result).toBeNull();
  });
});
