import type { PoolmasterLogger } from './types';

function normalizeGlobalError(error: unknown): unknown {
  if (error instanceof Error) {
    return error;
  }

  if (typeof error === 'string') {
    return new Error(error);
  }

  return error;
}

export function registerGlobalBrowserFailureHandlers(logger: PoolmasterLogger) {
  const handleWindowError = (event: ErrorEvent) => {
    logger.fatal(
      {
        action: 'app.unhandledError',
        err: normalizeGlobalError(event.error ?? event.message),
        data: {
          filename: event.filename || null,
          lineno: event.lineno || null,
          colno: event.colno || null,
        },
      },
      'Unhandled browser error',
    );
  };

  const handleUnhandledRejection = (event: PromiseRejectionEvent) => {
    logger.fatal(
      {
        action: 'app.unhandledRejection',
        err: normalizeGlobalError(event.reason),
      },
      'Unhandled promise rejection',
    );
  };

  window.addEventListener('error', handleWindowError);
  window.addEventListener('unhandledrejection', handleUnhandledRejection);

  return () => {
    window.removeEventListener('error', handleWindowError);
    window.removeEventListener('unhandledrejection', handleUnhandledRejection);
  };
}
