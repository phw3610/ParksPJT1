import { HeaderBackButton } from '@react-navigation/elements';
import { Stack, useRouter } from 'expo-router';
import React from 'react';

import { colors } from '@/lib/theme';

export default function SpaceDetailLayout() {
  const router = useRouter();

  return (
    <Stack
      screenOptions={{
        headerStyle: { backgroundColor: colors.bg },
        headerTintColor: colors.text,
        headerTitleStyle: { fontWeight: '600' },
        contentStyle: { backgroundColor: colors.bg },
      }}
    >
      <Stack.Screen
        name="index"
        options={{
          title: '앨범 홈',
          headerLeft: (props) => (
            <HeaderBackButton
              {...props}
              tintColor={colors.text}
              onPress={() => {
                if (router.canGoBack()) {
                  router.back();
                } else {
                  router.replace('/(app)/spaces');
                }
              }}
            />
          ),
        }}
      />
      <Stack.Screen name="folder/[folderId]" options={{ title: '폴더' }} />
      <Stack.Screen name="connect-storage" options={{ title: '저장소 연결' }} />
      <Stack.Screen name="invite" options={{ title: '가족 초대' }} />
      <Stack.Screen name="queue" options={{ title: '업로드 큐' }} />
      <Stack.Screen name="asset/[assetId]" options={{ title: '사진 상세' }} />
      <Stack.Screen name="members" options={{ title: '멤버 및 역할' }} />
    </Stack>
  );
}
