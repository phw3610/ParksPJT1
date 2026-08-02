import { HttpError, isRecord } from "./common.ts";
import type {
  DownloadTicket,
  RemoteEntry,
  RemoteRef,
  StorageErrorCode,
  StorageProvider,
  UploadInput,
  UploadSession,
} from "./types.ts";

const DRIVE = "https://www.googleapis.com/drive/v3";
const UPLOAD = "https://www.googleapis.com/upload/drive/v3";
const FOLDER_MIME = "application/vnd.google-apps.folder";
const APP_ROOT_NAME = "FamilyShare";
const MAX_RETRIES = 5;

interface ProviderOptions {
  signProxyUrl?: (ref: RemoteRef, ttlSec: number) => Promise<DownloadTicket>;
  onDisconnect?: (revoke: boolean) => Promise<void>;
}

interface DriveFile {
  id: string;
  name: string;
  mimeType?: string;
  size?: string;
  modifiedTime?: string;
  trashed?: boolean;
  parents?: string[];
}

interface DriveList {
  files?: DriveFile[];
  nextPageToken?: string;
}

interface DriveAbout {
  user?: { emailAddress?: string; displayName?: string };
  storageQuota?: { limit?: string; usage?: string };
}

export class DriveError extends Error {
  constructor(
    readonly code: StorageErrorCode,
    message: string,
    readonly status: number,
    readonly retryable = false,
  ) {
    super(message);
    this.name = "DriveError";
  }
}

export class GoogleDriveProvider implements StorageProvider {
  readonly kind = "google_drive" as const;

  constructor(
    private readonly auth: { getAccessToken(): Promise<string> },
    private readonly options: ProviderOptions = {},
  ) {}

  async connect(
    input: unknown,
  ): Promise<{ accountLabel: string; rootFolderId: string }> {
    if (!isRecord(input) || typeof input.spaceId !== "string") {
      throw new HttpError(400, "UNKNOWN", "spaceId 값이 올바르지 않습니다.");
    }
    const rootFolderId = await this.ensureAppRoot(input.spaceId);
    const about = await this.about();
    return {
      accountLabel: about.user?.emailAddress ?? about.user?.displayName ??
        "Google Drive",
      rootFolderId,
    };
  }

  async disconnect(opts?: { revoke?: boolean }): Promise<void> {
    if (!this.options.onDisconnect) return;
    await this.options.onDisconnect(opts?.revoke === true);
  }

  async verify(): Promise<
    { ok: true } | { ok: false; reason: StorageErrorCode }
  > {
    try {
      await this.req<DriveAbout>(`${DRIVE}/about?fields=user(emailAddress)`);
      return { ok: true };
    } catch (error) {
      return {
        ok: false,
        reason: error instanceof DriveError ? error.code : "UNKNOWN",
      };
    }
  }

  async createFolder(parentId: string, name: string): Promise<RemoteRef> {
    const result = await this.req<DriveFile>(`${DRIVE}/files?fields=id,name`, {
      method: "POST",
      body: JSON.stringify({
        name,
        mimeType: FOLDER_MIME,
        parents: [parentId],
      }),
    });
    return { fileId: result.id, path: result.name ?? name };
  }

  async list(
    folderId: string,
    cursor?: string,
  ): Promise<{ entries: RemoteEntry[]; cursor?: string }> {
    const query = new URLSearchParams({
      q: `'${escapeQuery(folderId)}' in parents and trashed = false`,
      fields: "nextPageToken,files(id,name,mimeType,size,modifiedTime)",
      pageSize: "100",
    });
    if (cursor) query.set("pageToken", cursor);
    const result = await this.req<DriveList>(`${DRIVE}/files?${query}`);
    return {
      entries: (result.files ?? []).map((file) => ({
        fileId: file.id,
        path: file.name,
        name: file.name,
        isFolder: file.mimeType === FOLDER_MIME,
        byteSize: file.size === undefined ? undefined : Number(file.size),
        modifiedAt: file.modifiedTime,
      })),
      cursor: result.nextPageToken,
    };
  }

  async createUploadSession(input: UploadInput): Promise<UploadSession> {
    const response = await this.fetchWithRetry(
      `${UPLOAD}/files?uploadType=resumable&fields=id`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json; charset=UTF-8",
          "X-Upload-Content-Type": input.mimeType,
          "X-Upload-Content-Length": String(input.byteSize),
        },
        body: JSON.stringify({
          name: `${input.assetId}_${input.originalName}`,
          parents: [input.parentFolderId],
        }),
      },
    );
    const uploadUrl = response.headers.get("Location");
    if (!uploadUrl) {
      throw new DriveError("UNKNOWN", "resumable 세션 URI가 없습니다.", 502);
    }
    return {
      uploadUrl,
      chunkSize: 8 * 1024 * 1024,
      expiresAt: new Date(Date.now() + 7 * 86_400_000).toISOString(),
    };
  }

  async finalizeUpload(
    _session: UploadSession,
    uploadedId: string,
  ): Promise<RemoteRef> {
    const file = await this.getFile(uploadedId, "id,name,trashed");
    if (file.trashed) {
      throw new DriveError(
        "NOT_FOUND",
        "업로드한 원본을 찾을 수 없습니다.",
        404,
      );
    }
    return { fileId: file.id, path: file.name };
  }

  async getDownloadTicket(
    ref: RemoteRef,
    ttlSec: number,
  ): Promise<DownloadTicket> {
    if (!this.options.signProxyUrl) {
      throw new DriveError(
        "UNSUPPORTED",
        "다운로드 티켓 서명기가 설정되지 않았습니다.",
        500,
      );
    }
    return await this.options.signProxyUrl(ref, ttlSec);
  }

  async delete(ref: RemoteRef, opts?: { permanent?: boolean }): Promise<void> {
    if (opts?.permanent) {
      await this.fetchWithRetry(
        `${DRIVE}/files/${encodeURIComponent(ref.fileId)}`,
        { method: "DELETE" },
      );
      return;
    }
    await this.req(
      `${DRIVE}/files/${encodeURIComponent(ref.fileId)}?fields=id,trashed`,
      {
        method: "PATCH",
        body: JSON.stringify({ trashed: true }),
      },
    );
  }

  async restore(ref: RemoteRef): Promise<void> {
    await this.req(
      `${DRIVE}/files/${encodeURIComponent(ref.fileId)}?fields=id,trashed`,
      {
        method: "PATCH",
        body: JSON.stringify({ trashed: false }),
      },
    );
  }

  async quota(): Promise<{ limit: number | null; usage: number } | null> {
    const about = await this.about();
    const quota = about.storageQuota;
    if (!quota) return null;
    return {
      limit: Number(quota.limit ?? 0) || null,
      usage: Number(quota.usage ?? 0),
    };
  }

  async about(): Promise<DriveAbout> {
    return await this.req<DriveAbout>(
      `${DRIVE}/about?fields=user(emailAddress,displayName),storageQuota(limit,usage)`,
    );
  }

  async ensureAppRoot(spaceId: string): Promise<string> {
    const appRoot = (await this.findFolder("root", APP_ROOT_NAME)) ??
      (await this.createFolder("root", APP_ROOT_NAME));
    const spaceRoot = (await this.findFolder(appRoot.fileId, spaceId)) ??
      (await this.createFolder(appRoot.fileId, spaceId));
    return spaceRoot.fileId;
  }

  async findFolder(parentId: string, name: string): Promise<RemoteRef | null> {
    const query = new URLSearchParams({
      q: [
        `'${escapeQuery(parentId)}' in parents`,
        `name = '${escapeQuery(name)}'`,
        `mimeType = '${FOLDER_MIME}'`,
        "trashed = false",
      ].join(" and "),
      fields: "files(id,name)",
      pageSize: "1",
    });
    const result = await this.req<DriveList>(`${DRIVE}/files?${query}`);
    const file = result.files?.[0];
    return file ? { fileId: file.id, path: file.name } : null;
  }

  async getFile(
    fileId: string,
    fields = "id,name,size,mimeType,trashed,parents",
  ): Promise<DriveFile> {
    return await this.req<DriveFile>(
      `${DRIVE}/files/${encodeURIComponent(fileId)}?fields=${
        encodeURIComponent(fields)
      }`,
    );
  }

  async download(fileId: string, range?: string | null): Promise<Response> {
    const headers: HeadersInit = {};
    if (range) headers.Range = range;
    return await this.fetchWithRetry(
      `${DRIVE}/files/${
        encodeURIComponent(fileId)
      }?alt=media&acknowledgeAbuse=false`,
      { headers },
    );
  }

  private async req<T = Record<string, unknown>>(
    url: string,
    init: RequestInit = {},
  ): Promise<T> {
    const response = await this.fetchWithRetry(url, init);
    if (response.status === 204) return {} as T;
    try {
      return (await response.json()) as T;
    } catch {
      throw new DriveError(
        "UNKNOWN",
        "Google Drive 응답을 해석하지 못했습니다.",
        502,
      );
    }
  }

  private async fetchWithRetry(
    url: string,
    init: RequestInit = {},
  ): Promise<Response> {
    for (let attempt = 0; attempt < MAX_RETRIES; attempt += 1) {
      let response: Response;
      try {
        const headers = new Headers(init.headers);
        headers.set(
          "Authorization",
          `Bearer ${await this.auth.getAccessToken()}`,
        );
        if (init.body && !headers.has("Content-Type")) {
          headers.set("Content-Type", "application/json");
        }
        response = await fetch(url, { ...init, headers });
      } catch (error) {
        if (attempt + 1 < MAX_RETRIES) {
          await delay(backoffMs(attempt));
          continue;
        }
        throw new DriveError(
          "NETWORK",
          error instanceof Error
            ? error.message
            : "Google Drive 네트워크 오류가 발생했습니다.",
          503,
          true,
        );
      }

      if (response.ok) return response;
      const mapped = await mapDriveError(response.clone());
      if (mapped.retryable && attempt + 1 < MAX_RETRIES) {
        await delay(retryDelay(response, attempt));
        continue;
      }
      throw mapped;
    }
    throw new DriveError(
      "UNKNOWN",
      "Google Drive 요청이 완료되지 않았습니다.",
      500,
    );
  }
}

async function mapDriveError(response: Response): Promise<DriveError> {
  let payload: Record<string, unknown> = {};
  try {
    const value: unknown = await response.json();
    if (isRecord(value)) payload = value;
  } catch {
    // Use HTTP status mapping below.
  }
  const errorObject = isRecord(payload.error) ? payload.error : {};
  const errors = Array.isArray(errorObject.errors) ? errorObject.errors : [];
  const first = errors.find(isRecord) as Record<string, unknown> | undefined;
  const reason = typeof first?.reason === "string" ? first.reason : "";
  const message = typeof errorObject.message === "string"
    ? errorObject.message
    : response.statusText;

  if (response.status === 401) {
    return new DriveError("TOKEN_EXPIRED", message, 401);
  }
  if (response.status === 404) return new DriveError("NOT_FOUND", message, 404);
  if (reason === "storageQuotaExceeded") {
    return new DriveError("QUOTA_EXCEEDED", message, 403);
  }
  if (
    reason === "userRateLimitExceeded" || reason === "rateLimitExceeded" ||
    response.status === 429
  ) {
    return new DriveError("RATE_LIMITED", message, 429, true);
  }
  if (response.status === 403) return new DriveError("FORBIDDEN", message, 403);
  if (response.status >= 500) {
    return new DriveError("NETWORK", message, 503, true);
  }
  return new DriveError(
    "UNKNOWN",
    message || "Google Drive 요청에 실패했습니다.",
    response.status,
  );
}

function escapeQuery(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/'/g, "\\'");
}

function retryDelay(response: Response, attempt: number): number {
  const retryAfter = Number(response.headers.get("Retry-After"));
  if (Number.isFinite(retryAfter) && retryAfter > 0) return retryAfter * 1000;
  return backoffMs(attempt);
}

function backoffMs(attempt: number): number {
  return Math.min(1000 * 2 ** attempt, 16_000) + Math.random() * 500;
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
