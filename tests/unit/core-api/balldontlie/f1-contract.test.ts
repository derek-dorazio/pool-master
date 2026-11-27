import { z } from 'zod';
import { balldontliePaginationSchema } from '../../../../packages/core-api/src/modules/ingestion/adapters/balldontlie/balldontlie-client';
import {
  f1DriverListSchema,
  f1DriverStandingListSchema,
  f1EventListSchema,
  f1SessionListSchema,
  f1SessionResultListSchema,
} from '../../../../packages/core-api/src/modules/ingestion/adapters/balldontlie/f1-contract';
import { contractGapsAgainst } from '../../../support/balldontlie-contract-gaps';
import { describeErrors, loadVendorSpec, readBalldontlieFixture } from '../../../support/balldontlie-vendor-spec';

/**
 * The BALLDONTLIE Formula 1 contract, held against the vendor's own published OpenAPI document
 * (vendored at tests/fixtures/balldontlie/openapi/f1.yml), the way the other leagues' contracts
 * are: every fixture fits the document and parses with the adapter's schemas, and every field the
 * adapter reads is documented, with a type, nullability and value set it accepts. The document
 * gives no response examples, so every fixture is written to it.
 */

const spec = loadVendorSpec('f1');

/**
 * The document requires only the state on an event and a session. These are read as always
 * present, each for the reason given.
 */
const PRESENT_BY_REQUEST: ReadonlyMap<string, string> = new Map([
  ['F1Event.id', 'an event with no id cannot be read again by event_ids[], which the adapter does'],
  ['F1Event.name', 'the one name a Grand Prix is placed on its slot by (NAME_PATTERN)'],
  ['F1Event.season', 'every event is listed under the season the adapter asked for by season'],
  ['F1Session.id', 'a session with no id cannot be asked for its results by session_ids[]'],
  ['F1Session.event', 'sessions are read by event_ids[], so each names the event it was listed under'],
  ['F1Session.type', 'the type is what the league\'s session type mappings name; a session with none plays as no Round'],
  ['F1SessionResult.session', 'results are read by session_ids[], so each names its session'],
  ['F1SessionResult.driver', 'a result is one driver\'s; the document describes no result without one'],
  ['F1DriverStanding.driver', 'a standing is one driver\'s place in the championship'],
  ['F1Driver.id', 'a driver record with no id is not a driver; the driver_ids[] filter reads it'],
  ['F1Driver.display_name', 'the one name a driver is shown by'],
  ['F1Event.circuit.name', 'a circuit is shown by its name'],
  ['F1Session.event.id', 'sessions are read by event_ids[], so each names the event it was listed under by its id'],
  ['F1SessionResult.session.id', 'results are read by session_ids[], so each names its session by its id'],
  ['F1SessionResult.driver.id', 'a driver record with no id is not a driver'],
  ['F1SessionResult.driver.display_name', 'the one name a driver is shown by'],
  ['F1SessionResult.driver.team.name', 'a team is shown by its name'],
  ['F1DriverStanding.driver.id', 'a driver record with no id is not a driver'],
  ['F1DriverStanding.driver.display_name', 'the one name a driver is shown by'],
  ['F1DriverStanding.driver.team.name', 'a team is shown by its name'],
]);

const contractGaps = contractGapsAgainst(spec, PRESENT_BY_REQUEST);

const fixtures: Array<[file: string, path: string, adapterSchema: z.ZodType]> = [
  ['events-2025.json', '/f1/v1/events', f1EventListSchema],
  ['sessions-2025.json', '/f1/v1/sessions', f1SessionListSchema],
  ['session-results-2025.json', '/f1/v1/session_results', f1SessionResultListSchema],
  ['driver-standings-2025.json', '/f1/v1/driver_standings', f1DriverStandingListSchema],
  ['driver-standings-2026.json', '/f1/v1/driver_standings', f1DriverStandingListSchema],
  ['drivers.json', '/f1/v1/drivers', f1DriverListSchema],
];

describe('BALLDONTLIE Formula 1 contract', () => {
  it.each(fixtures)('%s fits the vendor document\'s response schema for GET %s', (file, path) => {
    const validate = spec.responseValidator(path);
    const valid = validate(readBalldontlieFixture('f1', file));
    expect(describeErrors(validate)).toBe('');
    expect(valid).toBe(true);
  });

  it.each(fixtures)('%s parses with the adapter\'s schema for GET %s', (file, _path, adapterSchema) => {
    const parsed = adapterSchema.safeParse(readBalldontlieFixture('f1', file));
    expect(parsed.error?.issues ?? []).toEqual([]);
  });

  // Each list's row is its component; a nested one (the circuit, a driver, a team) is held where it is read.
  it.each([
    ['F1Event', f1EventListSchema.shape.data.element],
    ['F1Session', f1SessionListSchema.shape.data.element],
    ['F1SessionResult', f1SessionResultListSchema.shape.data.element],
    ['F1DriverStanding', f1DriverStandingListSchema.shape.data.element],
    ['F1Driver', f1DriverListSchema.shape.data.element],
    ['Pagination', balldontliePaginationSchema],
  ])('documents every field read from %s with a type, nullability and value set the adapter accepts', (component, adapterSchema) => {
    const ours = z.toJSONSchema(adapterSchema, { io: 'input' }) as Record<string, unknown>;
    expect(contractGaps(ours, spec.component(component), component)).toEqual([]);
  });

  it('flags a session\'s start read as never null, since the vendor documents it nullable', () => {
    const strict = z.toJSONSchema(z.object({ date: z.string().optional() }), { io: 'input' }) as Record<string, unknown>;
    expect(contractGaps(strict, spec.component('F1Session'), 'F1Session')).toEqual([
      expect.stringContaining('F1Session.date'),
    ]);
  });

  it('reads with the filters each endpoint documents: events by season and id, sessions by event, results by session, standings by the season they require', () => {
    const names = (path: string) => spec.queryParameters(path).map((each) => each.name);
    expect(names('/f1/v1/events')).toEqual(expect.arrayContaining(['season', 'event_ids[]', 'cursor', 'per_page']));
    expect(names('/f1/v1/sessions')).toEqual(expect.arrayContaining(['event_ids[]', 'cursor', 'per_page']));
    expect(names('/f1/v1/session_results')).toEqual(expect.arrayContaining(['session_ids[]', 'cursor', 'per_page']));
    expect(spec.queryParameters('/f1/v1/driver_standings')).toEqual(expect.arrayContaining([expect.objectContaining({ name: 'season', required: true })]));
  });
});
