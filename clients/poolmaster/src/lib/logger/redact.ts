import type { LogPayload } from './types';

const REDACTED_VALUE = '[REDACTED]';
const SENSITIVE_KEY_PATTERN =
  /^(password|passwordHash|authorization|cookie|accessToken|refreshToken|x-csrf-token)$/i;

function redactValue(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map((item) => redactValue(item));
  }

  if (!value || typeof value !== 'object') {
    return value;
  }

  if (value instanceof Error) {
    return {
      name: value.name,
      message: value.message,
      stack: value.stack,
    };
  }

  const result: Record<string, unknown> = {};
  for (const [key, nestedValue] of Object.entries(value)) {
    result[key] = SENSITIVE_KEY_PATTERN.test(key)
      ? REDACTED_VALUE
      : redactValue(nestedValue);
  }
  return result;
}

export function redactPayload(payload: LogPayload): LogPayload {
  return {
    action: payload.action,
    ...(payload.data ? { data: redactValue(payload.data) as Record<string, unknown> } : {}),
    ...(payload.err !== undefined ? { err: redactValue(payload.err) } : {}),
  };
}
