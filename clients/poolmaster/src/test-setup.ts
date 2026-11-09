import '@testing-library/jest-dom/vitest';
import { afterAll, afterEach, beforeAll } from 'vitest';
import { installDeviceColorScheme, resetDeviceColorScheme } from './test/device-color-scheme';
import { resetApiMocks, server } from './test/msw-api';

beforeAll(() => {
  server.listen({ onUnhandledFrame: 'error' });
});

installDeviceColorScheme();

afterEach(() => {
  server.resetHandlers();
  resetApiMocks();
  resetDeviceColorScheme();
});

afterAll(() => {
  server.close();
});

// jsdom does not implement scrollIntoView; every browser the app supports does.
Element.prototype.scrollIntoView = () => undefined;
