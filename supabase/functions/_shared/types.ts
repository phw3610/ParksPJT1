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
  /**
   * 바이트를 보내는 방식. provider마다 다르므로 클라이언트가 크기로 추측하면 안 된다.
   * - `drive-resumable`: 50MB 초과 시 Content-Range 청크 전송 (Google Drive)
   * - `single`: 크기와 무관하게 한 번의 PUT (S3 presigned URL)
   */
  protocol: "drive-resumable" | "single";
  /**
   * 업로드가 끝난 뒤 원본을 가리킬 식별자를 미리 아는 provider가 채운다.
   * S3는 키를 우리가 정하므로 미리 안다. Drive는 업로드 응답에서만 알 수 있어 null이다.
   */
  remoteFileId?: string | null;
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
