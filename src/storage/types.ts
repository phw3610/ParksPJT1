import type { StorageKind } from '@/lib/database.types';

export type ProviderKind = StorageKind;

export interface RemoteRef {
  /** Drive fileId / S3 key / WebDAV 절대경로 */
  fileId: string;
  /** 사람이 읽는 경로. 표시·디버깅용이며 기능은 fileId 기준으로 동작한다. */
  path: string;
}

export interface RemoteEntry extends RemoteRef {
  name: string;
  isFolder: boolean;
  byteSize?: number;
  modifiedAt?: string;
}

export interface UploadInput {
  assetId: string;
  parentFolderId: string;
  originalName: string;
  mimeType: string;
  byteSize: number;
}

export interface UploadSession {
  /** 클라이언트가 바이트를 직접 보낼 대상. null이면 서버 경유 업로드. */
  uploadUrl: string | null;
  chunkSize: number;
  expiresAt: string;
}

/**
 * getSignedUrl 대신 이 타입을 쓴다.
 * Drive와 WebDAV에는 만료 서명 URL 개념이 없어서, 통일된 서명 URL 인터페이스는
 * 두 provider가 거짓말을 하거나 예외를 던지게 만든다.
 */
export type DownloadTicket =
  | { kind: 'direct'; url: string; expiresAt: string } // S3 presigned — 서버 경유 없음
  | { kind: 'proxy'; url: string; expiresAt: string }; // Edge Function 중계

export interface StorageProvider {
  readonly kind: ProviderKind;

  connect(input: unknown): Promise<{ accountLabel: string; rootFolderId: string }>;
  disconnect(opts?: { revoke?: boolean }): Promise<void>;
  verify(): Promise<{ ok: true } | { ok: false; reason: StorageErrorCode }>;

  createFolder(parentId: string, name: string): Promise<RemoteRef>;
  list(folderId: string, cursor?: string): Promise<{ entries: RemoteEntry[]; cursor?: string }>;

  createUploadSession(input: UploadInput): Promise<UploadSession>;
  finalizeUpload(session: UploadSession, uploadedId: string): Promise<RemoteRef>;

  getDownloadTicket(ref: RemoteRef, ttlSec: number): Promise<DownloadTicket>;
  delete(ref: RemoteRef, opts?: { permanent?: boolean }): Promise<void>;

  quota(): Promise<{ limit: number | null; usage: number } | null>;
}

export type StorageErrorCode =
  | 'TOKEN_EXPIRED'
  | 'REVOKED'
  | 'QUOTA_EXCEEDED'
  | 'RATE_LIMITED'
  | 'NOT_FOUND'
  | 'FORBIDDEN'
  | 'NETWORK'
  | 'UNSUPPORTED'
  | 'UNKNOWN';
