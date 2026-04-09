import { useState, useCallback } from 'react';

type PushPermissionState = 'default' | 'granted' | 'denied' | 'unsupported';

export function usePushPermission() {
  const [permission, setPermission] = useState<PushPermissionState>(() => {
    if (typeof window === 'undefined' || !('Notification' in window)) {
      return 'unsupported';
    }
    return Notification.permission;
  });

  const requestPermission = useCallback(async (): Promise<PushPermissionState> => {
    if (permission === 'unsupported') return 'unsupported';

    const result = await Notification.requestPermission();
    setPermission(result);

    if (result === 'granted') {
      // TODO: Register service worker push subscription
      // const registration = await navigator.serviceWorker.ready;
      // const subscription = await registration.pushManager.subscribe({ ... });
      // await api.post('/notifications/push-subscriptions', subscription);
    }

    return result;
  }, [permission]);

  return {
    permission,
    isSupported: permission !== 'unsupported',
    isGranted: permission === 'granted',
    isDenied: permission === 'denied',
    isDefault: permission === 'default',
    requestPermission,
  };
}
