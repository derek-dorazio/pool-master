export const mockFeedProviderId = 'mock-contest-feed';

export const supportedSports = ['GOLF', 'TENNIS', 'NCAA_BASKETBALL', 'TEAM_TOURNAMENT'] as const;
export type SupportedSport = (typeof supportedSports)[number];

export const feedKinds = ['field', 'odds', 'rankings', 'results'] as const;
export type FeedKind = (typeof feedKinds)[number];

export const updateKinds = [...feedKinds] as const;
export type UpdateKind = (typeof updateKinds)[number];

export const updateTypeKinds = ['refresh', 'correction', 'live', 'final'] as const;
export type UpdateTypeKind = (typeof updateTypeKinds)[number];

export const eventStatusKinds = [
  'scheduled',
  'field_announced',
  'in_progress',
  'completed',
  'corrected',
] as const;
export type EventStatusKind = (typeof eventStatusKinds)[number];

export const fieldStatusKinds = ['provisional', 'announced', 'locked', 'final'] as const;
export type FieldStatusKind = (typeof fieldStatusKinds)[number];

export const participantStatusKinds = [
  'active',
  'provisional',
  'withdrawn',
  'alternate',
  'cut',
  'eliminated',
  'inactive',
] as const;
export type ParticipantStatusKind = (typeof participantStatusKinds)[number];

export const contestantOutcomeKinds = ['win', 'loss', 'tie', 'cut', 'withdrawn', 'pending'] as const;
export type ContestantOutcomeKind = (typeof contestantOutcomeKinds)[number];

export interface SeasonRecord {
  readonly seasonId: string;
  readonly name: string;
  readonly year: number;
  readonly startsAt?: string;
  readonly endsAt?: string;
}

export interface EventScheduleRecord {
  readonly startsAt: string;
  readonly endsAt?: string;
  readonly releaseAt?: string;
  readonly fieldLocksAt?: string;
}

export interface EventVenueRecord {
  readonly name: string;
  readonly city?: string;
  readonly region?: string;
  readonly countryCode?: string;
  readonly timeZone?: string;
}

export interface EventMetadataRecord {
  readonly officialName?: string;
  readonly eventType?: string;
  readonly tour?: string;
  readonly externalEventId?: string;
  readonly notes?: readonly string[];
}

export interface ContestantRecord {
  readonly contestantId: string;
  readonly name: string;
  readonly teamName?: string;
  readonly countryCode?: string;
  readonly seed?: number;
  readonly participantStatus?: ParticipantStatusKind;
  readonly odds?: number;
  readonly ranking?: number;
  readonly strokes?: number;
  readonly score?: number;
  readonly result?: ContestantOutcomeKind;
  readonly note?: string;
}

export interface ContestantDeltaRecord {
  readonly contestantId: string;
  readonly name?: string;
  readonly teamName?: string;
  readonly countryCode?: string;
  readonly seed?: number;
  readonly participantStatus?: ParticipantStatusKind;
  readonly odds?: number;
  readonly ranking?: number;
  readonly strokes?: number;
  readonly score?: number;
  readonly result?: ContestantOutcomeKind;
  readonly note?: string;
}

export interface FieldSnapshotRecord {
  readonly asOf: string;
  readonly status: FieldStatusKind;
  readonly note?: string;
  readonly contestants: readonly ContestantRecord[];
}

export interface FeedSnapshotRecord {
  readonly asOf: string;
  readonly note?: string;
  readonly contestants: readonly ContestantDeltaRecord[];
}

export interface EventFeedsRecord {
  readonly odds: FeedSnapshotRecord;
  readonly rankings: FeedSnapshotRecord;
  readonly results: FeedSnapshotRecord;
}

export interface FeedUpdateRecord {
  readonly updateId: string;
  readonly asOf: string;
  readonly feedKind: UpdateKind;
  readonly updateType: UpdateTypeKind;
  readonly note?: string;
  readonly contestants: readonly ContestantDeltaRecord[];
}

export interface ContestFeedEventRecord {
  readonly eventId: string;
  readonly name: string;
  readonly status: EventStatusKind;
  readonly schedule: EventScheduleRecord;
  readonly venue?: EventVenueRecord;
  readonly metadata?: EventMetadataRecord;
  readonly field: FieldSnapshotRecord;
  readonly feeds: EventFeedsRecord;
  readonly updates?: readonly FeedUpdateRecord[];
}

export interface ContestFeedScenarioRecord {
  readonly scenarioId: string;
  readonly sport: SupportedSport;
  readonly provider: typeof mockFeedProviderId;
  readonly description?: string;
  readonly season: SeasonRecord;
  readonly events: readonly ContestFeedEventRecord[];
}

export interface ScenarioSummary {
  readonly scenarioId: string;
  readonly sport: SupportedSport;
  readonly provider: typeof mockFeedProviderId;
  readonly description?: string;
  readonly seasonId: string;
  readonly seasonName: string;
  readonly seasonYear: number;
  readonly eventCount: number;
}

export interface EventSummary {
  readonly eventId: string;
  readonly name: string;
  readonly status: EventStatusKind;
  readonly startsAt: string;
  readonly endsAt?: string;
  readonly releaseAt?: string;
  readonly fieldLocksAt?: string;
  readonly venueName?: string;
  readonly fieldStatus: FieldStatusKind;
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
  readonly season: SeasonRecord;
  readonly event: ContestFeedEventRecord;
}

export interface ContestFeedUpdateResponse {
  readonly scenarioId: string;
  readonly eventId: string;
  readonly eventName: string;
  readonly updates: readonly FeedUpdateRecord[];
}

const participantStatusKindsSchemaEnum = [...participantStatusKinds] as const;
const contestantOutcomeKindsSchemaEnum = [...contestantOutcomeKinds] as const;

export const seasonRecordSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['seasonId', 'name', 'year'],
  properties: {
    seasonId: { type: 'string' },
    name: { type: 'string' },
    year: { type: 'integer' },
    startsAt: { type: 'string', format: 'date-time' },
    endsAt: { type: 'string', format: 'date-time' },
  },
} as const;

export const scheduleRecordSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['startsAt'],
  properties: {
    startsAt: { type: 'string', format: 'date-time' },
    endsAt: { type: 'string', format: 'date-time' },
    releaseAt: { type: 'string', format: 'date-time' },
    fieldLocksAt: { type: 'string', format: 'date-time' },
  },
} as const;

export const venueRecordSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['name'],
  properties: {
    name: { type: 'string' },
    city: { type: 'string' },
    region: { type: 'string' },
    countryCode: { type: 'string' },
    timeZone: { type: 'string' },
  },
} as const;

export const metadataRecordSchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    officialName: { type: 'string' },
    eventType: { type: 'string' },
    tour: { type: 'string' },
    externalEventId: { type: 'string' },
    notes: { type: 'array', items: { type: 'string' } },
  },
} as const;

export const contestantRecordSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['contestantId', 'name'],
  properties: {
    contestantId: { type: 'string' },
    name: { type: 'string' },
    teamName: { type: 'string' },
    countryCode: { type: 'string' },
    seed: { type: 'number' },
    participantStatus: { type: 'string', enum: participantStatusKindsSchemaEnum },
    odds: { type: 'number' },
    ranking: { type: 'number' },
    strokes: { type: 'number' },
    score: { type: 'number' },
    result: { type: 'string', enum: contestantOutcomeKindsSchemaEnum },
    note: { type: 'string' },
  },
} as const;

export const contestantDeltaRecordSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['contestantId'],
  properties: {
    contestantId: { type: 'string' },
    name: { type: 'string' },
    teamName: { type: 'string' },
    countryCode: { type: 'string' },
    seed: { type: 'number' },
    participantStatus: { type: 'string', enum: participantStatusKindsSchemaEnum },
    odds: { type: 'number' },
    ranking: { type: 'number' },
    strokes: { type: 'number' },
    score: { type: 'number' },
    result: { type: 'string', enum: contestantOutcomeKindsSchemaEnum },
    note: { type: 'string' },
  },
} as const;

export const fieldSnapshotSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['asOf', 'status', 'contestants'],
  properties: {
    asOf: { type: 'string', format: 'date-time' },
    status: { type: 'string', enum: fieldStatusKinds },
    note: { type: 'string' },
    contestants: {
      type: 'array',
      items: contestantRecordSchema,
    },
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
      items: contestantDeltaRecordSchema,
    },
  },
} as const;

export const eventFeedsSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['odds', 'rankings', 'results'],
  properties: {
    odds: feedSnapshotSchema,
    rankings: feedSnapshotSchema,
    results: feedSnapshotSchema,
  },
} as const;

export const feedUpdateSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['updateId', 'asOf', 'feedKind', 'updateType', 'contestants'],
  properties: {
    updateId: { type: 'string' },
    asOf: { type: 'string', format: 'date-time' },
    feedKind: { type: 'string', enum: updateKinds },
    updateType: { type: 'string', enum: updateTypeKinds },
    note: { type: 'string' },
    contestants: {
      type: 'array',
      items: contestantDeltaRecordSchema,
    },
  },
} as const;

export const eventRecordSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['eventId', 'name', 'status', 'schedule', 'field', 'feeds'],
  properties: {
    eventId: { type: 'string' },
    name: { type: 'string' },
    status: { type: 'string', enum: eventStatusKinds },
    schedule: scheduleRecordSchema,
    venue: venueRecordSchema,
    metadata: metadataRecordSchema,
    field: fieldSnapshotSchema,
    feeds: eventFeedsSchema,
    updates: {
      type: 'array',
      items: feedUpdateSchema,
    },
  },
} as const;

export const scenarioRecordSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['scenarioId', 'sport', 'provider', 'season', 'events'],
  properties: {
    scenarioId: { type: 'string' },
    sport: { type: 'string', enum: supportedSports },
    provider: { type: 'string', const: mockFeedProviderId },
    description: { type: 'string' },
    season: seasonRecordSchema,
    events: { type: 'array', items: eventRecordSchema },
  },
} as const;

export const scenarioSummarySchema = {
  type: 'object',
  additionalProperties: false,
  required: ['scenarioId', 'sport', 'provider', 'seasonId', 'seasonName', 'seasonYear', 'eventCount'],
  properties: {
    scenarioId: { type: 'string' },
    sport: { type: 'string', enum: supportedSports },
    provider: { type: 'string', const: mockFeedProviderId },
    description: { type: 'string' },
    seasonId: { type: 'string' },
    seasonName: { type: 'string' },
    seasonYear: { type: 'integer' },
    eventCount: { type: 'number' },
  },
} as const;

export const eventSummarySchema = {
  type: 'object',
  additionalProperties: false,
  required: ['eventId', 'name', 'status', 'startsAt', 'fieldStatus', 'contestantCount'],
  properties: {
    eventId: { type: 'string' },
    name: { type: 'string' },
    status: { type: 'string', enum: eventStatusKinds },
    startsAt: { type: 'string', format: 'date-time' },
    endsAt: { type: 'string', format: 'date-time' },
    releaseAt: { type: 'string', format: 'date-time' },
    fieldLocksAt: { type: 'string', format: 'date-time' },
    venueName: { type: 'string' },
    fieldStatus: { type: 'string', enum: fieldStatusKinds },
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
  required: ['scenarioId', 'sport', 'provider', 'season', 'event'],
  properties: {
    scenarioId: { type: 'string' },
    sport: { type: 'string', enum: supportedSports },
    provider: { type: 'string', const: mockFeedProviderId },
    scenarioDescription: { type: 'string' },
    season: seasonRecordSchema,
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
