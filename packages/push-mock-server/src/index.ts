/**
 * Push Mock Server — captures APNs and FCM push payloads for local development.
 *
 * Mimics the real APNs HTTP/2 and FCM v1 REST APIs. Stores payloads
 * in memory and exposes them via a log API for test verification.
 *
 * Ports: 3099 (configurable via PORT env var)
 */

import Fastify from 'fastify';
import crypto from 'node:crypto';

interface PushLogEntry {
  id: string;
  platform: 'apns' | 'fcm';
  deviceToken?: string;
  projectId?: string;
  payload: unknown;
  receivedAt: string;
}

const MAX_LOG_SIZE = 1000;
const pushLog: PushLogEntry[] = [];

function addLogEntry(entry: PushLogEntry): void {
  pushLog.unshift(entry);
  if (pushLog.length > MAX_LOG_SIZE) {
    pushLog.length = MAX_LOG_SIZE;
  }
}

const app = Fastify({ logger: true });

// --- APNs mock ---
// Real endpoint: POST https://api.push.apple.com/3/device/{deviceToken}

app.post<{ Params: { deviceToken: string } }>(
  '/apns/3/device/:deviceToken',
  async (request, reply) => {
    const apnsId = crypto.randomUUID();

    addLogEntry({
      id: apnsId,
      platform: 'apns',
      deviceToken: request.params.deviceToken,
      payload: request.body,
      receivedAt: new Date().toISOString(),
    });

    app.log.info(
      { apnsId, token: request.params.deviceToken },
      'APNs push received',
    );

    return reply
      .status(200)
      .header('apns-id', apnsId)
      .send();
  },
);

// --- FCM mock ---
// Real endpoint: POST https://fcm.googleapis.com/v1/projects/{projectId}/messages:send

app.post<{ Params: { projectId: string } }>(
  '/fcm/v1/projects/:projectId/messages:send',
  async (request) => {
    const messageId = `projects/${request.params.projectId}/messages/${crypto.randomUUID()}`;

    addLogEntry({
      id: messageId,
      platform: 'fcm',
      projectId: request.params.projectId,
      payload: request.body,
      receivedAt: new Date().toISOString(),
    });

    app.log.info(
      { messageId, projectId: request.params.projectId },
      'FCM push received',
    );

    return { name: messageId };
  },
);

// --- Log inspection API ---

app.get('/push-log', async (request) => {
  const qs = request.query as { platform?: string; limit?: string };
  let entries = pushLog;

  if (qs.platform) {
    entries = entries.filter((e) => e.platform === qs.platform);
  }

  const limit = qs.limit ? parseInt(qs.limit, 10) : 100;
  return { entries: entries.slice(0, limit), total: entries.length };
});

app.delete('/push-log', async () => {
  const cleared = pushLog.length;
  pushLog.length = 0;
  return { cleared };
});

// --- Health ---

app.get('/health', async () => {
  return { status: 'ok', service: 'push-mock-server', logSize: pushLog.length };
});

// --- Start ---

async function start(): Promise<void> {
  const port = Number(process.env.PORT ?? 3099);
  try {
    await app.listen({ port, host: '0.0.0.0' });
  } catch (err) {
    app.log.error(err);
    process.exit(1);
  }
}

start();
