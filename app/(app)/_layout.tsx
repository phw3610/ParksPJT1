import { Stack, useRouter } from 'expo-router';
import React, { useEffect } from 'react';

import { useAuth } from '@/auth';
import { colors } from '@/lib/theme';
import {
  listenNotificationResponses,
  registerDeviceToken,
  setupNotificationHandler,
} from '@/notifications';

setupNotificationHandler();

export default function AppLayout() {
  const { user } = useAuth();
  const router = useRouter();

  useEffect(() => {
    if (!user) return;

    // 1. 디바이스 네이티브 푸시 토큰 등록
    registerDeviceToken();

    // 2. 알림 탭 응답 수신 리스너 등록
    const cleanup = listenNotificationResponses(router);
    return cleanup;
  }, [user?.id, router]);

  return (
    <Stack
      screenOptions={{
        headerStyle: { backgroundColor: colors.bg },
        headerTintColor: colors.text,
        headerTitleStyle: { fontWeight: '600' },
        contentStyle: { backgroundColor: colors.bg },
      }}
    >
      <Stack.Screen name="spaces/index" options={{ title: '내 스페이스' }} />
      <Stack.Screen name="spaces/create" options={{ title: '새 앨범 만들기', presentation: 'modal' }} />
      <Stack.Screen name="spaces/[spaceId]" options={{ headerShown: false }} />
    </Stack>
  );
}
