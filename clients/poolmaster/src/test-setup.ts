import '@testing-library/jest-dom/vitest';
import { afterAll, afterEach, beforeAll } from 'vitest';
import { dismissAllToasts } from './features/shared/ui/toast-store';
import { installDeviceColorScheme, resetDeviceColorScheme } from './test/device-color-scheme';
import { resetApiMocks, server } from './test/msw-api';
import { installResizeObserver } from './test/resize-observer';

beforeAll(() => {
  server.listen({ onUnhandledFrame: 'error' });
});

installDeviceColorScheme();
installResizeObserver();

afterEach(() => {
  server.resetHandlers();
  resetApiMocks();
  resetDeviceColorScheme();
  // Toasts live in one module-level list for the whole app; each test starts with none.
  dismissAllToasts();
});

afterAll(() => {
  server.close();
});

// jsdom does not implement scrollIntoView; every browser the app supports does.
Element.prototype.scrollIntoView = () => undefined;
