export type MemberRole = "owner" | "admin" | "member" | "viewer";
export type ProviderKind =
  | "google_drive"
  | "webdav"
  | "s3_compatible"
  | "naver_mybox";

export type StorageErrorCode =
  | "TOKEN_EXPIRED"
  | "REVOKED"
  | "QUOTA_EXCEEDED"
  | "RATE_LIMITED"
  | "NOT_FOUND"
  | "FORBIDDEN"
  | "NETWORK"
  | "UNSUPPORTED"
  | "UNKNOWN";

export interface RemoteRef {
  fileId: string;
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
  uploadUrl: string | null;
  chunkSize: number;
  expiresAt: string;
}

export type DownloadTicket =
  | { kind: "direct"; url: string; expiresAt: string }
  | { kind: "proxy"; url: string; expiresAt: string };

export interface StorageProvider {
  readonly kind: ProviderKind;

  connect(
    input: unknown,
  ): Promise<{ accountLabel: string; rootFolderId: string }>;
  disconnect(opts?: { revoke?: boolean }): Promise<void>;
  verify(): Promise<{ ok: true } | { ok: false; reason: StorageErrorCode }>;

  createFolder(parentId: string, name: string): Promise<RemoteRef>;
  list(
    folderId: string,
    cursor?: string,
  ): Promise<{ entries: RemoteEntry[]; cursor?: string }>;

  createUploadSession(input: UploadInput): Promise<UploadSession>;
  finalizeUpload(
    session: UploadSession,
    uploadedId: string,
  ): Promise<RemoteRef>;

  getDownloadTicket(ref: RemoteRef, ttlSec: number): Promise<DownloadTicket>;
  delete(ref: RemoteRef, opts?: { permanent?: boolean }): Promise<void>;
  /** 휴지통으로 보낸 파일을 되돌린다. permanent 삭제는 되돌릴 수 없다. */
  restore(ref: RemoteRef): Promise<void>;

  quota(): Promise<{ limit: number | null; usage: number } | null>;
}

export interface StorageConnectionRow {
  id: string;
  space_id: string;
  provider: ProviderKind;
  connected_by: string;
  account_label: string | null;
  root_folder_id: string | null;
  vault_secret_id: string;
  is_active: boolean;
  last_error: string | null;
  last_verified_at: string | null;
  created_at: string;
}
