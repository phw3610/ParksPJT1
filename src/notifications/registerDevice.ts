import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';

import { supabase } from '@/lib/supabase';

/**
 * 네이티브 디바이스 푸시 토큰(FCM/APNs)을 획득하여 Supabase devices 테이블에 등록/갱신합니다.
 * 백엔드(FCM/APNs 직접 전송) 호환성을 위해 getExpoPushTokenAsync 대신 getDevicePushTokenAsync를 사용해야 합니다.
 * 실패 시에도 앱 동작을 방해하지 않도록 에러를 조용히 상쇄합니다.
 */
export async function registerDeviceToken(): Promise<void> {
  try {
    const rawPlatform = Platform.OS;
    if (rawPlatform !== 'ios' && rawPlatform !== 'android') {
      return;
    }
    const platform: 'ios' | 'android' = rawPlatform;

    // 1. 현재 인증된 사용자 확인 (RLS devices_all policy: user_id = auth.uid())
    const {
      data: { session },
    } = await supabase.auth.getSession();
    if (!session?.user) {
      return;
    }

    // 2. 알림 권한 확인 및 요청
    const perm = await Notifications.requestPermissionsAsync({
      ios: { allowAlert: true, allowBadge: true, allowSound: true },
    });
    if (!perm.granted) {
      return;
    }

    // 3. 네이티브 디바이스 토큰 획득 (Expo 토큰 getExpoPushTokenAsync 금지!)
    const tokenResult = await Notifications.getDevicePushTokenAsync();
    const pushToken = typeof tokenResult.data === 'string' ? tokenResult.data : String(tokenResult.data);

    if (!pushToken) {
      return;
    }

    // 4. devices 테이블에 upsert (onConflict: 'push_token')
    await (supabase.from('devices') as any).upsert(
      {
        user_id: session.user.id,
        push_token: pushToken,
        platform,
        last_seen_at: new Date().toISOString(),
      },
      { onConflict: 'push_token' }
    );
  } catch {
    // 시뮬레이터, 권한 거부, 네트워크 오류 등은 조용히 넘김
  }
}
