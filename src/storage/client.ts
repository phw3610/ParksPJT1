import { callFunction, FunctionError } from '@/lib/supabase';

import { StorageError } from './errors';
import type { DownloadTicket, StorageErrorCode, UploadSession } from './types';

/**
 * 클라이언트가 보는 스토리지 API. 실제 provider 호출은 전부 Edge Function 안에서 일어난다.
 * 기기는 refresh token은 물론 access token도 갖지 않는다 — 업로드 세션 URI만 받는다.
 */

export interface ConnectResult {
  connectionId: string;
  accountLabel: string;
  rootFolderId: string;
  quota: { limit: number | null; usage: number } | null;
}

export async function connectGoogleDrive(spaceId: string, serverAuthCode: string) {
  return wrap(() =>
    callFunction<ConnectResult>('storage-connect', {
      spaceId,
      provider: 'google_drive',
      serverAuthCode,
    }),
  );
}

export async function disconnectStorage(spaceId: string, revokeToken = false) {
  return wrap(() => callFunction<{ ok: true }>('storage-disconnect', { spaceId, revokeToken }));
}

export interface CreateSessionInput {
  spaceId: string;
  folderId: string | null;
  originalName: string;
  mimeType: string;
  byteSize: number;
  capturedAt: string | null;
  width?: number;
  height?: number;
  durationMs?: number;
  kind: 'image' | 'video';
  contentHash?: string;
}

export interface CreateSessionResult extends UploadSession {
  assetId: string;
  provider: string;
}

export async function createUploadSession(input: CreateSessionInput) {
  return wrap(() => callFunction<CreateSessionResult>('uploads-create-session', { ...input }));
}

export async function completeUpload(assetId: string, remoteFileId: string, thumbUploaded: boolean) {
  return wrap(() =>
    callFunction<{ status: 'ready' }>('uploads-complete', { assetId, remoteFileId, thumbUploaded }),
  );
}

export async function failUpload(assetId: string, errorCode: string) {
  // 실패 보고가 또 실패해도 업로드 흐름을 막지 않는다.
  try {
    await callFunction('uploads-fail', { assetId, errorCode });
  } catch {
    /* 무시 */
  }
}

export async function getDownloadTickets(assetIds: string[]) {
  return wrap(() =>
    callFunction<{ tickets: ({ assetId: string } & DownloadTicket)[] }>('downloads-ticket', {
      assetIds,
    }),
  );
}

export async function deleteAssets(assetIds: string[], deleteRemote = true) {
  return wrap(() => callFunction<{ ok: true }>('assets-delete', { assetIds, deleteRemote }));
}

const KNOWN_CODES: StorageErrorCode[] = [
  'TOKEN_EXPIRED',
  'REVOKED',
  'QUOTA_EXCEEDED',
  'RATE_LIMITED',
  'NOT_FOUND',
  'FORBIDDEN',
  'NETWORK',
  'UNSUPPORTED',
  'UNKNOWN',
];

/** Edge Function 오류를 StorageError로 정규화한다. */
async function wrap<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (e) {
    if (e instanceof FunctionError) {
      const code = (KNOWN_CODES as string[]).includes(e.code)
        ? (e.code as StorageErrorCode)
        : 'UNKNOWN';
      throw new StorageError(code, e.message, code === 'RATE_LIMITED');
    }
    throw new StorageError('NETWORK', e instanceof Error ? e.message : String(e), true);
  }
}
