import { HttpError, isRecord } from "./common.ts";
import { encodeKey, objectUrl, presignUrl, type S3Credentials, signedFetch } from "./sigv4.ts";
import type {
  DownloadTicket,
  RemoteEntry,
  RemoteRef,
  StorageErrorCode,
  StorageProvider,
  UploadInput,
  UploadSession,
} from "./types.ts";

/** 업로드 URL 유효시간. 큰 영상도 이 안에 끝나야 한다. */
const UPLOAD_TTL_SECONDS = 6 * 60 * 60;

export class S3Error extends Error {
  constructor(
    readonly code: StorageErrorCode,
    message: string,
    readonly status: number,
    readonly retryable = false,
  ) {
    super(message);
    this.name = "S3Error";
  }
}

/** docs/03 §3.2의 provider별 매핑 표를 따른다. */
function mapS3Error(status: number, body: string): S3Error {
  const codeMatch = body.match(/<Code>([^<]+)<\/Code>/);
  const s3Code = codeMatch?.[1] ?? "";

  if (status === 404 || s3Code === "NoSuchKey" || s3Code === "NoSuchBucket") {
    return new S3Error("NOT_FOUND", "원본을 찾을 수 없습니다.", status);
  }
  if (s3Code === "ExpiredToken" || s3Code === "TokenRefreshRequired") {
    return new S3Error(
      "TOKEN_EXPIRED",
      "저장소 인증이 만료됐습니다. 다시 연결해 주세요.",
      status,
    );
  }
  if (s3Code === "InvalidAccessKeyId" || s3Code === "SignatureDoesNotMatch") {
    return new S3Error(
      "REVOKED",
      "저장소 접근 키가 더 이상 유효하지 않습니다. 다시 연결해 주세요.",
      status,
    );
  }
  if (s3Code === "SlowDown" || status === 429) {
    return new S3Error("RATE_LIMITED", "저장소가 바쁩니다.", status, true);
  }
  if (status === 403 || s3Code === "AccessDenied") {
    return new S3Error(
      "FORBIDDEN",
      "이 버킷에 접근할 권한이 없습니다. 액세스 키 권한을 확인해 주세요.",
      status,
    );
  }
  if (status >= 500) {
    return new S3Error("NETWORK", "저장소에 연결하지 못했습니다.", status, true);
  }
  return new S3Error("UNKNOWN", `저장소 오류 (${status}) ${s3Code}`.trim(), status);
}

function xmlValues(xml: string, tag: string): string[] {
  const matches = xml.matchAll(new RegExp(`<${tag}>([\\s\\S]*?)</${tag}>`, "g"));
  return Array.from(matches, (m) => m[1]);
}

function xmlValue(block: string, tag: string): string | undefined {
  return block.match(new RegExp(`<${tag}>([\\s\\S]*?)</${tag}>`))?.[1];
}

/** XML 본문에 그대로 넣으면 &, <, > 가 문서를 깨뜨린다. */
function decodeXmlText(value: string): string {
  return value
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
}

export function parseS3Credentials(value: unknown): S3Credentials {
  if (!isRecord(value)) {
    throw new HttpError(400, "UNKNOWN", "저장소 자격증명 형식이 올바르지 않습니다.");
  }
  const required = ["endpoint", "region", "bucket", "accessKeyId", "secretAccessKey"] as const;
  for (const field of required) {
    if (typeof value[field] !== "string" || (value[field] as string).length === 0) {
      throw new HttpError(400, "UNKNOWN", `${field} 값이 필요합니다.`);
    }
  }

  const endpoint = (value.endpoint as string).trim().replace(/\/+$/, "");
  // 평문 HTTP는 자격증명과 사진이 가정 네트워크 밖에서 그대로 노출된다.
  // docs/phase0 §0.4의 "신뢰된 CA 인증서 HTTPS만 허용" 정책이다.
  if (!endpoint.startsWith("https://")) {
    throw new HttpError(
      400,
      "UNSUPPORTED",
      "저장소 주소는 https:// 로 시작해야 합니다. NAS에 인증서를 먼저 설정해 주세요.",
    );
  }

  return {
    endpoint,
    region: (value.region as string).trim() || "us-east-1",
    bucket: (value.bucket as string).trim(),
    accessKeyId: (value.accessKeyId as string).trim(),
    secretAccessKey: value.secretAccessKey as string,
    forcePathStyle: value.forcePathStyle !== false,
  };
}

/**
 * S3 호환 저장소(MinIO / Synology / QNAP / R2 등).
 *
 * Drive와 가장 크게 다른 점은 **기기가 NAS와 직접 통신한다**는 것이다.
 * 업로드도 다운로드도 presigned URL이라 우리 서버 대역폭이 0이다.
 * 대신 폴더가 실재하지 않고 키 프리픽스만 있어서 createFolder는 아무것도 만들지 않는다.
 */
export class S3CompatibleProvider implements StorageProvider {
  readonly kind = "s3_compatible" as const;

  constructor(private readonly credentials: S3Credentials) {}

  private async request(
    method: string,
    key: string,
    options: { query?: Record<string, string>; headers?: Record<string, string> } = {},
  ): Promise<Response> {
    let response: Response;
    try {
      response = await signedFetch(this.credentials, method, key, options);
    } catch (error) {
      throw new S3Error(
        "NETWORK",
        `저장소에 연결하지 못했습니다: ${(error as Error)?.message ?? "네트워크 오류"}`,
        0,
        true,
      );
    }
    if (!response.ok) {
      throw mapS3Error(response.status, await response.text().catch(() => ""));
    }
    return response;
  }

  async connect(
    input: unknown,
  ): Promise<{ accountLabel: string; rootFolderId: string }> {
    if (!isRecord(input) || typeof input.spaceId !== "string") {
      throw new HttpError(400, "UNKNOWN", "spaceId 값이 올바르지 않습니다.");
    }

    // 키를 하나도 안 만들고 버킷 접근 권한만 확인한다.
    await this.request("GET", "", {
      query: { "list-type": "2", "max-keys": "1" },
    });

    const host = new URL(this.credentials.endpoint).host;
    return {
      accountLabel: `${this.credentials.bucket} @ ${host}`,
      rootFolderId: `FamilyShare/${input.spaceId}`,
    };
  }

  async disconnect(): Promise<void> {
    // 보관한 자격증명은 storage-disconnect가 vault에서 지운다. 원격에서 할 일은 없다.
  }

  async verify(): Promise<{ ok: true } | { ok: false; reason: StorageErrorCode }> {
    try {
      await this.request("GET", "", { query: { "list-type": "2", "max-keys": "1" } });
      return { ok: true };
    } catch (error) {
      return { ok: false, reason: error instanceof S3Error ? error.code : "UNKNOWN" };
    }
  }

  /** S3에 폴더는 없다. 프리픽스를 계산해 돌려줄 뿐 원격에는 아무것도 만들지 않는다. */
  createFolder(parentId: string, name: string): Promise<RemoteRef> {
    const key = `${parentId.replace(/\/+$/, "")}/${name}`;
    return Promise.resolve({ fileId: key, path: key });
  }

  async list(
    folderId: string,
    cursor?: string,
  ): Promise<{ entries: RemoteEntry[]; cursor?: string }> {
    const prefix = folderId ? `${folderId.replace(/\/+$/, "")}/` : "";
    const query: Record<string, string> = {
      "list-type": "2",
      delimiter: "/",
      "max-keys": "1000",
    };
    if (prefix) query.prefix = prefix;
    if (cursor) query["continuation-token"] = cursor;

    const xml = await (await this.request("GET", "", { query })).text();

    const entries: RemoteEntry[] = [];

    // CommonPrefixes가 하위 폴더 역할을 한다.
    for (const block of xmlValues(xml, "CommonPrefixes")) {
      const raw = xmlValue(block, "Prefix");
      if (!raw) continue;
      const key = decodeXmlText(raw).replace(/\/+$/, "");
      entries.push({
        fileId: key,
        path: key,
        name: key.slice(prefix.length),
        isFolder: true,
      });
    }

    for (const block of xmlValues(xml, "Contents")) {
      const raw = xmlValue(block, "Key");
      if (!raw) continue;
      const key = decodeXmlText(raw);
      if (key === prefix) continue; // 프리픽스 자체를 나타내는 0바이트 키는 폴더 표시용이다
      const size = xmlValue(block, "Size");
      entries.push({
        fileId: key,
        path: key,
        name: key.slice(prefix.length),
        isFolder: false,
        byteSize: size ? Number(size) : undefined,
        modifiedAt: xmlValue(block, "LastModified"),
      });
    }

    const truncated = xmlValue(xml, "IsTruncated") === "true";
    const next = xmlValue(xml, "NextContinuationToken");
    return { entries, cursor: truncated && next ? decodeXmlText(next) : undefined };
  }

  /**
   * presigned PUT 하나를 돌려준다. 기기가 이 URL로 NAS에 직접 올린다.
   *
   * Drive처럼 이어올리기(resumable)를 하지 않으므로 `protocol: 'single'`을 실어 보낸다.
   * 클라이언트가 Content-Range 청크 전송을 쓰면 S3는 그 헤더를 모르고 파일을 통째로
   * 첫 청크로 덮어써 버린다 — 반드시 세션이 알려주는 방식대로 보내야 한다.
   */
  async createUploadSession(input: UploadInput): Promise<UploadSession> {
    const key = `${input.parentFolderId.replace(/\/+$/, "")}/${input.assetId}_${input.originalName}`;
    const uploadUrl = await presignUrl(
      this.credentials,
      "PUT",
      key,
      UPLOAD_TTL_SECONDS,
    );

    return {
      uploadUrl,
      protocol: "single",
      remoteFileId: key,
      chunkSize: 0,
      expiresAt: new Date(Date.now() + UPLOAD_TTL_SECONDS * 1000).toISOString(),
    };
  }

  /** 업로드된 키가 실제로 올라왔는지 HEAD로 확인한다. */
  async finalizeUpload(
    _session: UploadSession,
    uploadedId: string,
  ): Promise<RemoteRef> {
    await this.request("HEAD", uploadedId);
    return { fileId: uploadedId, path: uploadedId };
  }

  /** presigned GET. Range를 지원하므로 영상 탐색도 그대로 된다. */
  async getDownloadTicket(ref: RemoteRef, ttlSec: number): Promise<DownloadTicket> {
    const url = await presignUrl(this.credentials, "GET", ref.fileId, ttlSec);
    return {
      kind: "direct",
      url,
      expiresAt: new Date(Date.now() + ttlSec * 1000).toISOString(),
    };
  }

  /**
   * S3에는 휴지통이 없다. 되돌릴 수 없는 삭제를 앱이 대신 결정하지 않으려고,
   * 일반 삭제는 원격을 건드리지 않고 앱 휴지통에만 맡긴다.
   * 실제 객체 삭제는 permanent일 때만 한다.
   */
  async delete(ref: RemoteRef, opts?: { permanent?: boolean }): Promise<void> {
    if (!opts?.permanent) return;
    await this.request("DELETE", ref.fileId);
  }

  /** 일반 삭제가 원격을 건드리지 않으므로 되돌릴 것도 없다. */
  restore(_ref: RemoteRef): Promise<void> {
    return Promise.resolve();
  }

  /** S3 프로토콜에 용량 개념이 없다. NAS 여유 공간은 알 수 없다. */
  quota(): Promise<{ limit: number | null; usage: number } | null> {
    return Promise.resolve(null);
  }
}

export { encodeKey, objectUrl };
export type { S3Credentials };
