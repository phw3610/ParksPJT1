import type { StorageErrorCode } from './types';

export class StorageError extends Error {
  constructor(
    readonly code: StorageErrorCode,
    message: string,
    readonly retryable = false,
    readonly originalCode: string = code,
    readonly originalMessage: string = message,
    readonly httpStatus?: number,
  ) {
    super(message);
    this.name = 'StorageError';
  }
}

export interface OriginalErrorDetails {
  code: string;
  message: string;
  status?: number;
}

/** 사용자 문구와 별도로 진단에 필요한 원본 오류를 보존한다. */
export function originalErrorDetails(error: unknown): OriginalErrorDetails {
  if (error instanceof StorageError) {
    return {
      code: error.originalCode,
      message: error.originalMessage,
      status: error.httpStatus,
    };
  }

  if (error instanceof Error) {
    const errorWithCode = error as Error & { code?: unknown };
    return {
      code: typeof errorWithCode.code === 'string' ? errorWithCode.code : error.name || 'UNKNOWN',
      message: error.message,
    };
  }

  if (typeof error === 'object' && error !== null) {
    const value = error as { code?: unknown; message?: unknown };
    return {
      code: typeof value.code === 'string' ? value.code : 'UNKNOWN',
      message: typeof value.message === 'string' ? value.message : String(error),
    };
  }

  return { code: 'UNKNOWN', message: String(error) };
}

/** 사용자에게 보여줄 한국어 문구. 없는 코드는 일반 문구로 떨어진다. */
const MESSAGES: Record<StorageErrorCode, string> = {
  TOKEN_EXPIRED: 'Google 드라이브 연결이 만료됐어요.\n다시 연결하면 밀린 사진이 이어서 올라가요.',
  REVOKED: 'Google 드라이브 접근 권한이 해제됐어요.\n다시 연결해 주세요.',
  QUOTA_EXCEEDED: 'Google 드라이브 저장 공간이 가득 찼어요.\n공간을 정리한 뒤 다시 시도해 주세요.',
  RATE_LIMITED: '요청이 많아 잠시 후 다시 시도할게요.',
  NOT_FOUND: '원본을 찾을 수 없어요. 드라이브에서 삭제된 것 같아요.',
  FORBIDDEN: '이 파일에 접근할 수 없어요.',
  NETWORK: '인터넷 연결을 확인해 주세요.\n올리던 사진은 연결되면 이어서 올라가요.',
  UNSUPPORTED: '이 저장소에서는 지원하지 않는 기능이에요.',
  UNKNOWN: '문제가 생겼어요. 잠시 후 다시 시도해 주세요.',
};

export function userMessage(e: unknown): string {
  if (e instanceof StorageError) return MESSAGES[e.code];
  return MESSAGES.UNKNOWN;
}

/** 백오프 후 재시도해도 되는 오류인지 */
export function isRetryable(e: unknown): boolean {
  if (!(e instanceof StorageError)) return false;
  return e.retryable || e.code === 'RATE_LIMITED' || e.code === 'NETWORK';
}

/**
 * 재인증이 필요한 오류. 이 경우 업로드 큐를 **일시정지**하고 삭제하지 않는다.
 * 사용자가 다시 연결하면 밀린 항목이 그대로 이어진다.
 */
export function needsReconnect(e: unknown): boolean {
  return e instanceof StorageError && (e.code === 'TOKEN_EXPIRED' || e.code === 'REVOKED');
}

/** 지수 백오프 + 지터. Retry-After 헤더가 있으면 그 값을 우선한다. */
export function backoffMs(attempt: number, retryAfterSec?: number): number {
  if (retryAfterSec) return retryAfterSec * 1000;
  const base = Math.min(1000 * 2 ** attempt, 16_000);
  return base + Math.random() * 500;
}
