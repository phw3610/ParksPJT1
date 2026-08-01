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
    // FunctionsHttpError.context는 Response다. 본문 파싱 실패 시 원래 오류로 안전하게 폴백한다.
    const context = (error as {
      context?: { status?: unknown; clone?: () => { json: () => Promise<unknown> } };
    }).context;
    const status = typeof context?.status === 'number' ? context.status : undefined;
    let detail: { code?: string; message?: string } | undefined;

    if (typeof context?.clone === 'function') {
      try {
        const payload = await context.clone().json();
        if (typeof payload === 'object' && payload !== null && 'error' in payload) {
          const responseError = (payload as { error?: unknown }).error;
          if (typeof responseError === 'object' && responseError !== null) {
            const value = responseError as { code?: unknown; message?: unknown };
            detail = {
              code: typeof value.code === 'string' ? value.code : undefined,
              message: typeof value.message === 'string' ? value.message : undefined,
            };
          }
        }
      } catch {
        // 게이트웨이 HTML/빈 본문 등은 구조화되지 않은 원래 오류로 처리한다.
      }
    }

    throw new FunctionError(detail?.code ?? 'UNKNOWN', detail?.message ?? error.message, status);
  }
  if (data === null) throw new FunctionError('UNKNOWN', '빈 응답을 받았습니다.');
  return data;
}

export class FunctionError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly status?: number,
  ) {
    super(message);
    this.name = 'FunctionError';
  }
}
