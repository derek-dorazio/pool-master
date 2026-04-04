export const mockFeedProviderId = 'mock-contest-feed';

export const supportedSports = ['GOLF', 'TENNIS', 'NCAA_BASKETBALL', 'TEAM_TOURNAMENT'] as const;
export type SupportedSport = (typeof supportedSports)[number];

export const feedKinds = ['odds', 'rankings', 'results'] as const;
export type FeedKind = (typeof feedKinds)[number];

export const updateKinds = ['odds', 'rankings', 'results'] as const;
export type UpdateKind = (typeof updateKinds)[number];

export const contestantOutcomeKinds = ['win', 'loss', 'tie', 'cut', 'withdrawn', 'pending'] as const;
export type ContestantOutcomeKind = (typeof contestantOutcomeKinds)[number];
const contestantOutcomeKindsSchemaEnum = [...contestantOutcomeKinds] as const;

export interface ContestantRecord {
  readonly contestantId: string;
  readonly name: string;
  readonly teamName?: string;
  readonly seed?: number;
  readonly odds?: number;
  readonly ranking?: number;
  readonly score?: number;
  readonly result?: ContestantOutcomeKind;
  readonly note?: string;
}

export interface FeedSnapshotRecord {
  readonly asOf: string;
  readonly contestants: readonly ContestantRecord[];
  readonly note?: string;
}

export interface FeedUpdateRecord {
  readonly updateId: string;
  readonly asOf: string;
  readonly feedKind: UpdateKind;
  readonly note?: string;
  readonly contestants: readonly ContestantRecord[];
}

export interface ContestFeedEventRecord {
  readonly eventId: string;
  readonly name: string;
  readonly startsAt: string;
  readonly endsAt?: string;
  readonly venue?: string;
  readonly contestants: readonly ContestantRecord[];
  readonly odds: FeedSnapshotRecord;
  readonly rankings: FeedSnapshotRecord;
  readonly results: FeedSnapshotRecord;
  readonly updates?: readonly FeedUpdateRecord[];
}

export interface ContestFeedScenarioRecord {
  readonly scenarioId: string;
  readonly sport: SupportedSport;
  readonly provider: typeof mockFeedProviderId;
  readonly description?: string;
  readonly events: readonly ContestFeedEventRecord[];
}

export interface ScenarioSummary {
  readonly scenarioId: string;
  readonly sport: SupportedSport;
  readonly provider: typeof mockFeedProviderId;
  readonly description?: string;
  readonly eventCount: number;
}

export interface EventSummary {
  readonly eventId: string;
  readonly name: string;
  readonly startsAt: string;
  readonly endsAt?: string;
  readonly venue?: string;
  readonly contestantCount: number;
}

export interface ContestFeedSnapshotResponse {
  readonly scenarioId: string;
  readonly eventId: string;
  readonly eventName: string;
  readonly feedKind: FeedKind;
  readonly asOf: string;
  readonly note?: string;
  readonly contestants: readonly ContestantRecord[];
}

export interface ContestFeedEventResponse {
  readonly scenarioId: string;
  readonly sport: SupportedSport;
  readonly provider: typeof mockFeedProviderId;
  readonly scenarioDescription?: string;
  readonly event: ContestFeedEventRecord;
}

export interface ContestFeedUpdateResponse {
  readonly scenarioId: string;
  readonly eventId: string;
  readonly eventName: string;
  readonly updates: readonly FeedUpdateRecord[];
}

export const contestantRecordSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['contestantId', 'name'],
  properties: {
    contestantId: { type: 'string' },
    name: { type: 'string' },
    teamName: { type: 'string' },
    seed: { type: 'number' },
    odds: { type: 'number' },
    ranking: { type: 'number' },
    score: { type: 'number' },
    result: { type: 'string', enum: contestantOutcomeKindsSchemaEnum },
    note: { type: 'string' },
  },
} as const;

export const feedSnapshotSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['asOf', 'contestants'],
  properties: {
    asOf: { type: 'string', format: 'date-time' },
    note: { type: 'string' },
    contestants: {
      type: 'array',
      items: contestantRecordSchema,
    },
  },
} as const;

export const feedUpdateSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['updateId', 'asOf', 'feedKind', 'contestants'],
  properties: {
    updateId: { type: 'string' },
    asOf: { type: 'string', format: 'date-time' },
    feedKind: { type: 'string', enum: updateKinds },
    note: { type: 'string' },
    contestants: {
      type: 'array',
      items: contestantRecordSchema,
    },
  },
} as const;

export const eventRecordSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['eventId', 'name', 'startsAt', 'contestants', 'odds', 'rankings', 'results'],
  properties: {
    eventId: { type: 'string' },
    name: { type: 'string' },
    startsAt: { type: 'string', format: 'date-time' },
    endsAt: { type: 'string', format: 'date-time' },
    venue: { type: 'string' },
    contestants: { type: 'array', items: contestantRecordSchema },
    odds: feedSnapshotSchema,
    rankings: feedSnapshotSchema,
    results: feedSnapshotSchema,
    updates: {
      type: 'array',
      items: feedUpdateSchema,
    },
  },
} as const;

export const scenarioRecordSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['scenarioId', 'sport', 'provider', 'events'],
  properties: {
    scenarioId: { type: 'string' },
    sport: { type: 'string', enum: supportedSports },
    provider: { type: 'string', const: mockFeedProviderId },
    description: { type: 'string' },
    events: { type: 'array', items: eventRecordSchema },
  },
} as const;

export const scenarioSummarySchema = {
  type: 'object',
  additionalProperties: false,
  required: ['scenarioId', 'sport', 'provider', 'eventCount'],
  properties: {
    scenarioId: { type: 'string' },
    sport: { type: 'string', enum: supportedSports },
    provider: { type: 'string', const: mockFeedProviderId },
    description: { type: 'string' },
    eventCount: { type: 'number' },
  },
} as const;

export const eventSummarySchema = {
  type: 'object',
  additionalProperties: false,
  required: ['eventId', 'name', 'startsAt', 'contestantCount'],
  properties: {
    eventId: { type: 'string' },
    name: { type: 'string' },
    startsAt: { type: 'string', format: 'date-time' },
    endsAt: { type: 'string', format: 'date-time' },
    venue: { type: 'string' },
    contestantCount: { type: 'number' },
  },
} as const;

export const snapshotResponseSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['scenarioId', 'eventId', 'eventName', 'feedKind', 'asOf', 'contestants'],
  properties: {
    scenarioId: { type: 'string' },
    eventId: { type: 'string' },
    eventName: { type: 'string' },
    feedKind: { type: 'string', enum: feedKinds },
    asOf: { type: 'string', format: 'date-time' },
    note: { type: 'string' },
    contestants: { type: 'array', items: contestantRecordSchema },
  },
} as const;

export const eventResponseSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['scenarioId', 'sport', 'provider', 'event'],
  properties: {
    scenarioId: { type: 'string' },
    sport: { type: 'string', enum: supportedSports },
    provider: { type: 'string', const: mockFeedProviderId },
    scenarioDescription: { type: 'string' },
    event: eventRecordSchema,
  },
} as const;

export const updatesResponseSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['scenarioId', 'eventId', 'eventName', 'updates'],
  properties: {
    scenarioId: { type: 'string' },
    eventId: { type: 'string' },
    eventName: { type: 'string' },
    updates: { type: 'array', items: feedUpdateSchema },
  },
} as const;
