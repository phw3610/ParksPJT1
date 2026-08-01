import * as Notifications from 'expo-notifications';
import { Router } from 'expo-router';

import { registerDeviceToken } from './registerDevice';

export * from './registerDevice';

/**
 * 포그라운드 상태에서 알림 수신 시 표시 방식 설정
 */
export function setupNotificationHandler(): void {
  Notifications.setNotificationHandler({
    handleNotification: async () => ({
      shouldShowBanner: true,
      shouldShowList: true,
      shouldPlaySound: true,
      shouldSetBadge: false,
    }),
  });
}

/**
 * 알림 탭(수신 응답) 시 딥링크 처리 리스너를 등록합니다.
 * notify Edge Function이 전송하는 data: { type: 'new_assets', spaceId: string }
 */
export function listenNotificationResponses(router: Router): () => void {
  const subscription = Notifications.addNotificationResponseReceivedListener((response) => {
    try {
      const data = response.notification.request.content.data;
      if (data && data.type === 'new_assets' && typeof data.spaceId === 'string') {
        router.push(`/(app)/spaces/${data.spaceId}` as const);
      }
    } catch {
      /* Navigation failure swallowed */
    }
  });

  return () => {
    subscription.remove();
  };
}
