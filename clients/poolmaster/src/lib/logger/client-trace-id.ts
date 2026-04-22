const CLIENT_TRACE_ID_KEY = 'poolmaster_client_trace_id';

let inMemoryClientTraceId: string | null = null;

function createTraceId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }

  return `pm-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

export function getOrCreateClientTraceId(): string {
  try {
    const existing = window.sessionStorage.getItem(CLIENT_TRACE_ID_KEY);
    if (existing) {
      return existing;
    }

    const created = createTraceId();
    window.sessionStorage.setItem(CLIENT_TRACE_ID_KEY, created);
    return created;
  } catch {
    if (!inMemoryClientTraceId) {
      inMemoryClientTraceId = createTraceId();
    }
    return inMemoryClientTraceId;
  }
}

export function resetClientTraceIdForTests() {
  inMemoryClientTraceId = null;
}
