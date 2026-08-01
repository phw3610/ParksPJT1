import { Stack } from 'expo-router';
import React from 'react';

import { colors } from '@/lib/theme';

export default function AppLayout() {
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
