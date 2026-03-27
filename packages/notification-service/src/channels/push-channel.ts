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
  subtitle?: string;
  data?: Record<string, string>;
  badge?: number;
  sound?: string;
  imageUrl?: string;
  category?: string;
  priority?: 'high' | 'normal';
  channelId?: string;
}

export interface PushDeliveryResult {
  success: boolean;
  messageId?: string;
  error?: string;
  token?: string;
}

export interface PushProvider {
  readonly platform: 'apns' | 'fcm';
  sendToDevice(token: string, payload: PushPayload): Promise<PushDeliveryResult>;
  sendBatch(notifications: { token: string; payload: PushPayload }[]): Promise<PushDeliveryResult[]>;
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
      const alert: Record<string, string> = {
        title: payload.title,
        body: payload.body,
      };
      if (payload.subtitle) {
        alert.subtitle = payload.subtitle;
      }

      const apnsPayload: Record<string, unknown> = {
        aps: {
          alert,
          badge: payload.badge,
          sound: payload.sound ?? 'default',
          'mutable-content': payload.imageUrl ? 1 : 0,
          ...(payload.category && { category: payload.category }),
        },
        ...payload.data,
      };

      const apnsPriority = payload.priority === 'normal' ? '5' : '10';

      const response = await fetch(
        `${this.config.baseUrl}/apns/3/device/${token}`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'apns-topic': this.config.bundleId,
            'apns-push-type': 'alert',
            'apns-priority': apnsPriority,
            authorization: `bearer ${this.config.keyId}`,
          },
          body: JSON.stringify(apnsPayload),
        },
      );

      if (!response.ok) {
        const errorBody = await response.text();
        return { success: false, error: `APNs ${response.status}: ${errorBody}`, token };
      }

      return {
        success: true,
        messageId: response.headers.get('apns-id') ?? undefined,
        token,
      };
    } catch (err) {
      return { success: false, error: err instanceof Error ? err.message : String(err), token };
    }
  }

  async sendBatch(
    notifications: { token: string; payload: PushPayload }[],
  ): Promise<PushDeliveryResult[]> {
    return Promise.all(
      notifications.map(({ token, payload }) => this.sendToDevice(token, payload)),
    );
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
      const fcmPriority = payload.priority === 'normal' ? 'normal' : 'high';
      const channelId = payload.channelId ?? 'poolmaster_default';

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
            priority: fcmPriority,
            notification: {
              sound: payload.sound ?? 'default',
              channel_id: channelId,
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
        return { success: false, error: `FCM ${response.status}: ${errorBody}`, token };
      }

      const result = (await response.json()) as { name?: string };
      return { success: true, messageId: result.name, token };
    } catch (err) {
      return { success: false, error: err instanceof Error ? err.message : String(err), token };
    }
  }

  async sendBatch(
    notifications: { token: string; payload: PushPayload }[],
  ): Promise<PushDeliveryResult[]> {
    return Promise.all(
      notifications.map(({ token, payload }) => this.sendToDevice(token, payload)),
    );
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

    if (devices.length === 0) return [];

    const iosDevices = devices.filter((d) => d.platform === 'ios');
    const androidDevices = devices.filter((d) => d.platform !== 'ios');

    const results: PushDeliveryResult[] = [];

    if (iosDevices.length > 0) {
      const apnsResults = await this.providers.apns.sendBatch(
        iosDevices.map((d) => ({ token: d.token, payload })),
      );
      results.push(...apnsResults);
    }

    if (androidDevices.length > 0) {
      const fcmResults = await this.providers.fcm.sendBatch(
        androidDevices.map((d) => ({ token: d.token, payload })),
      );
      results.push(...fcmResults);
    }

    // Deactivate tokens that got invalid-token errors
    const invalidTokens = results
      .filter((r) => !r.success && r.error?.includes('BadDeviceToken'))
      .map((r) => r.token)
      .filter((t): t is string => !!t);

    if (invalidTokens.length > 0) {
      await this.prisma.deviceRegistration.updateMany({
        where: { token: { in: invalidTokens } },
        data: { isActive: false },
      });
    }

    return results;
  }

  /** Sends a push notification to multiple users in batch. */
  async sendToUsers(userIds: string[], payload: PushPayload): Promise<PushDeliveryResult[]> {
    const results: PushDeliveryResult[] = [];
    for (const userId of userIds) {
      const userResults = await this.sendToUser(userId, payload);
      results.push(...userResults);
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
