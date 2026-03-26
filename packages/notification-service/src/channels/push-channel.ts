/**
 * PushChannel — sends push notifications via APNs (iOS) and FCM (Android).
 *
 * Both providers accept a configurable base URL. In dev, this points to the
 * push-mock-server (http://localhost:3099). In prod, it points to the real
 * APNs/FCM endpoints. No conditional logic — swapped entirely by env config.
 */

import type { PrismaClient } from '@prisma/client';

// --- Provider Interface ---

export interface PushPayload {
  title: string;
  body: string;
  data?: Record<string, string>;
  badge?: number;
  sound?: string;
  imageUrl?: string;
}

export interface PushDeliveryResult {
  success: boolean;
  messageId?: string;
  error?: string;
}

export interface PushProvider {
  readonly platform: 'apns' | 'fcm';
  sendToDevice(token: string, payload: PushPayload): Promise<PushDeliveryResult>;
}

// --- APNs Provider ---

export class ApnsPushProvider implements PushProvider {
  readonly platform = 'apns' as const;

  constructor(
    private readonly config: {
      baseUrl: string;
      keyId: string;
      teamId: string;
      bundleId: string;
    },
  ) {}

  async sendToDevice(token: string, payload: PushPayload): Promise<PushDeliveryResult> {
    try {
      const apnsPayload = {
        aps: {
          alert: { title: payload.title, body: payload.body },
          badge: payload.badge,
          sound: payload.sound ?? 'default',
          'mutable-content': payload.imageUrl ? 1 : 0,
        },
        ...payload.data,
      };

      const response = await fetch(
        `${this.config.baseUrl}/apns/3/device/${token}`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'apns-topic': this.config.bundleId,
            'apns-push-type': 'alert',
            'apns-priority': '10',
            authorization: `bearer ${this.config.keyId}`,
          },
          body: JSON.stringify(apnsPayload),
        },
      );

      if (!response.ok) {
        const errorBody = await response.text();
        return { success: false, error: `APNs ${response.status}: ${errorBody}` };
      }

      return {
        success: true,
        messageId: response.headers.get('apns-id') ?? undefined,
      };
    } catch (err) {
      return { success: false, error: err instanceof Error ? err.message : String(err) };
    }
  }
}

// --- FCM Provider ---

export class FcmPushProvider implements PushProvider {
  readonly platform = 'fcm' as const;

  constructor(
    private readonly config: {
      baseUrl: string;
      projectId: string;
    },
  ) {}

  async sendToDevice(token: string, payload: PushPayload): Promise<PushDeliveryResult> {
    try {
      const fcmPayload = {
        message: {
          token,
          notification: {
            title: payload.title,
            body: payload.body,
            ...(payload.imageUrl && { image: payload.imageUrl }),
          },
          data: payload.data,
          android: {
            priority: 'high',
            notification: {
              sound: payload.sound ?? 'default',
              channel_id: 'poolmaster_default',
            },
          },
        },
      };

      const response = await fetch(
        `${this.config.baseUrl}/fcm/v1/projects/${this.config.projectId}/messages:send`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: 'Bearer dev-token',
          },
          body: JSON.stringify(fcmPayload),
        },
      );

      if (!response.ok) {
        const errorBody = await response.text();
        return { success: false, error: `FCM ${response.status}: ${errorBody}` };
      }

      const result = (await response.json()) as { name?: string };
      return { success: true, messageId: result.name };
    } catch (err) {
      return { success: false, error: err instanceof Error ? err.message : String(err) };
    }
  }
}

// --- PushChannel (orchestrates providers + device token lookup) ---

export class PushChannel {
  constructor(
    private readonly providers: { apns: PushProvider; fcm: PushProvider },
    private readonly prisma: PrismaClient,
  ) {}

  /** Sends a push notification to all active devices for a user. */
  async sendToUser(userId: string, payload: PushPayload): Promise<PushDeliveryResult[]> {
    const devices = await this.prisma.deviceRegistration.findMany({
      where: { userId, isActive: true },
    });

    const results: PushDeliveryResult[] = [];
    for (const device of devices) {
      const provider = device.platform === 'ios' ? this.providers.apns : this.providers.fcm;
      const result = await provider.sendToDevice(device.token, payload);
      results.push(result);
    }

    return results;
  }

  /** Sends a push notification to a specific device token. */
  async sendToDevice(
    platform: 'ios' | 'android',
    token: string,
    payload: PushPayload,
  ): Promise<PushDeliveryResult> {
    const provider = platform === 'ios' ? this.providers.apns : this.providers.fcm;
    return provider.sendToDevice(token, payload);
  }
}
