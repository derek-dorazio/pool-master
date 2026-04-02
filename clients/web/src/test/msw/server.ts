/**
 * MSW server instance for Vitest.
 *
 * Imported by test-setup.ts to start/stop the server around tests.
 * onUnhandledRequest: 'error' ensures any fetch to an unhandled URL
 * immediately fails the test — catching path mismatches.
 */
import { setupServer } from 'msw/node';
import { handlers } from './handlers';

export const server = setupServer(...handlers);
