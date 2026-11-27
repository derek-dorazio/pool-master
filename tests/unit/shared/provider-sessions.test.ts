import { sessionRounds, type ProviderSession } from '../../../packages/shared/domain';

/** A Formula 1 weekend as the feed lists it, out of order: practice, qualifying, a sprint and the race. */
const weekend: ProviderSession[] = [
  { providerSessionId: '5503', sessionType: 'Race', startsAt: new Date('2025-05-25T13:00:00Z') },
  { providerSessionId: '5501', sessionType: 'Practice', startsAt: new Date('2025-05-23T11:30:00Z') },
  { providerSessionId: '5504', sessionType: 'Sprint', startsAt: new Date('2025-05-24T10:30:00Z') },
  { providerSessionId: '5502', sessionType: 'Qualifying', startsAt: new Date('2025-05-24T14:00:00Z') },
];

const roundsOf = (sessions: readonly ProviderSession[], types: readonly string[]) => sessionRounds(sessions, new Set(types))
  .map(({ roundNumber, session }) => [roundNumber, session.providerSessionId]);

describe('the sessions an event plays as Rounds (#2045)', () => {
  it('plays only the race when the league plays only the Race type, as its Round 1', () => {
    expect(roundsOf(weekend, ['Race'])).toEqual([[1, '5503']]);
  });

  it('numbers several played types from 1 in the order they start, not the order the feed lists them', () => {
    expect(roundsOf(weekend, ['Race', 'Sprint'])).toEqual([[1, '5504'], [2, '5503']]);
  });

  it('plays nothing when the league plays no type the event has', () => {
    expect(roundsOf(weekend, ['Feature'])).toEqual([]);
    expect(roundsOf(weekend, [])).toEqual([]);
  });

  it('leaves out a session with no start yet, so numbering it later never shifts a Round after it', () => {
    const unscheduledSprint = weekend.map((session) => (session.sessionType === 'Sprint' ? { ...session, startsAt: null } : session));
    expect(roundsOf(unscheduledSprint, ['Race', 'Sprint'])).toEqual([[1, '5503']]);
  });

  it('orders two sessions starting together by the provider\'s id, so the numbering never changes between reads', () => {
    const together = [
      { providerSessionId: 'b', sessionType: 'Heat', startsAt: new Date('2025-05-24T10:00:00Z') },
      { providerSessionId: 'a', sessionType: 'Heat', startsAt: new Date('2025-05-24T10:00:00Z') },
    ];
    expect(roundsOf(together, ['Heat'])).toEqual([[1, 'a'], [2, 'b']]);
  });
});
