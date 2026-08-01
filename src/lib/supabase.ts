import 'react-native-url-polyfill/auto';

import AsyncStorage from '@react-native-async-storage/async-storage';
import { createClient } from '@supabase/supabase-js';
import { AppState } from 'react-native';

import { config } from './config';
import type { Database } from './database.types';

export const supabase = createClient<Database>(config.supabase.url, config.supabase.anonKey, {
  auth: {
    storage: AsyncStorage,
    autoRefreshToken: true,
    persistSession: true,
    // 네이티브에는 URL 콜백 세션 감지가 필요 없다.
    detectSessionInUrl: false,
  },
});

/**
 * 앱이 백그라운드에 있는 동안 토큰 자동 갱신을 멈춘다.
 * 이걸 안 하면 백그라운드에서 불필요한 네트워크 호출이 계속 발생한다.
 */
AppState.addEventListener('change', (state) => {
  if (state === 'active') supabase.auth.startAutoRefresh();
  else supabase.auth.stopAutoRefresh();
});

/** Edge Function 호출 헬퍼. 오류를 우리 형식으로 정규화한다. */
export async function callFunction<T>(name: string, body: Record<string, unknown>): Promise<T> {
  const { data, error } = await supabase.functions.invoke<T>(name, { body });

  if (error) {
    // Edge Function이 { error: { code, message } }를 반환한 경우 그대로 살린다.
    const detail = (error as { context?: { error?: { code?: string; message?: string } } }).context?.error;
    throw new FunctionError(detail?.code ?? 'UNKNOWN', detail?.message ?? error.message);
  }
  if (data === null) throw new FunctionError('UNKNOWN', '빈 응답을 받았습니다.');
  return data;
}

export class FunctionError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'FunctionError';
  }
}
