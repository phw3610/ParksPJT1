# 03 — API 명세 & StorageProvider 설계

전제: [02 ERD & RLS](./02-erd-and-rls.md). 백엔드 = Supabase.

---

## 1. API 표면 정리 — 무엇을 직접 쿼리하고 무엇을 Edge Function으로 보내는가

| 작업 | 경로 | 이유 |
|---|---|---|
| 폴더/에셋 조회, 생성, 이름변경, 이동 | **PostgREST 직접** (RLS가 지킴) | 왕복 1회, 실시간과 일관된 모델 |
| 초대 수락·미리보기 | **RPC** (`accept_invite`, `preview_invite`) | 아직 멤버가 아닌 사용자의 삽입이라 RLS로 표현 불가 |
| 스토리지 연결/해제/재인증 | **Edge Function** | OAuth 코드 교환, refresh token은 서버만 취급 |
| 업로드 세션 발급 | **Edge Function** | Drive resumable 세션 URI는 서버 토큰으로만 열 수 있음 |
| 다운로드 티켓 발급 + 스트림 | **Edge Function** | Owner 토큰 대행, 원본 URL 비노출 |
| 삭제(원본까지) | **Edge Function** | DB 행과 원격 파일을 함께 정리 |
| 푸시 발송 | **Edge Function** (DB 트리거/웹훅) | FCM/APNs 키는 서버 전용 |

원칙: **자격증명이 필요한 모든 것은 Edge Function, 나머지는 RLS.**

---

## 2. Edge Function 명세

공통: 인증은 `Authorization: Bearer <supabase_access_token>`. 함수는 토큰에서 `auth.uid()`를 얻고, 대상 스페이스에 대한 권한을 **함수 안에서 다시 검증**한다(RLS를 우회하는 `service_role`을 쓰기 때문).

공통 오류 형식:
```json
{ "error": { "code": "STORAGE_QUOTA_EXCEEDED", "message": "Google 드라이브 저장 공간이 가득 찼어요" } }
```

### 2.1 `POST /storage/connect`

Owner가 Google 계정을 연결한다.

```jsonc
// req
{
  "spaceId": "uuid",
  "provider": "google_drive",
  "serverAuthCode": "4/0Ade..."      // google-signin의 serverAuthCode
}
// res 200
{
  "connectionId": "uuid",
  "accountLabel": "park○○@gmail.com",
  "rootFolderId": "1AbC...",
  "quota": { "limit": 16106127360, "usage": 8804682956 }
}
```

동작:
1. 호출자가 해당 스페이스의 `owner`인지 확인. 아니면 `403 FORBIDDEN`.
2. `serverAuthCode`를 Google 토큰 엔드포인트에서 교환 → `access_token` + **`refresh_token`**.
3. `refresh_token`을 **Supabase Vault에 저장**, 반환된 secret id를 `storage_connections.vault_secret_id`에 기록.
4. `/FamilyShare/{spaceId}` 폴더를 생성(이미 있으면 재사용) → `root_folder_id` 저장.
5. `about.get?fields=storageQuota`로 용량 조회.

`refresh_token`이 응답에 없는 경우(재동의) → `prompt=consent` 재요청을 클라이언트에 지시하는 `NEEDS_CONSENT` 오류를 반환한다.

### 2.2 `POST /storage/disconnect`

```jsonc
{ "spaceId": "uuid", "revokeToken": true }
```
Vault 시크릿 삭제 + `is_active=false`. `revokeToken`이면 Google `/revoke` 호출. **원격 파일은 삭제하지 않는다**(사용자 Drive에 그대로 남긴다).

### 2.3 `POST /uploads/create-session`

업로드 1건마다 호출. 클라이언트는 반환된 세션 URI로 **Drive에 직접** 바이트를 전송한다(서버 경유 없음).

```jsonc
// req
{
  "spaceId": "uuid",
  "folderId": "uuid | null",
  "originalName": "IMG_0421.HEIC",
  "mimeType": "image/heic",
  "byteSize": 4823019,
  "capturedAt": "2026-07-14T09:31:02+09:00",
  "width": 4032, "height": 3024,
  "kind": "image",
  "contentHash": "sha256:..."          // 선택 (Phase 2 중복 감지)
}
// res 200
{
  "assetId": "uuid",
  "uploadUrl": "https://www.googleapis.com/upload/drive/v3/files?uploadType=resumable&upload_id=...",
  "provider": "google_drive",
  "expiresAt": "2026-08-08T00:00:00Z",   // Drive 세션은 1주
  "chunkSize": 8388608                    // 8MB (256KB 배수)
}
```

동작:
1. `can_write(spaceId)` 확인. Viewer면 `403 VIEWER_CANNOT_UPLOAD`.
2. Vault에서 refresh token 복호화 → access token 획득(60분 캐시).
3. 대상 폴더의 `drive_folder_id`를 확인. 없으면 폴더 경로를 Drive에 생성하고 DB에 기록.
4. Drive resumable 세션 개시(`POST ...uploadType=resumable`) → `Location` 헤더의 세션 URI 획득.
5. `assets` 행을 `status='uploading'`으로 선삽입 → 다른 멤버 화면에 "올리는 중" 플레이스홀더가 즉시 보인다.

**세션 URI를 클라이언트에 주는 게 안전한가:** 그렇다. 이 URI는 **해당 파일 1건의 업로드에만** 유효하고 다른 Drive 리소스에 접근할 수 없다. access token 자체를 넘기는 것과 근본적으로 다르다.

### 2.4 `POST /uploads/complete`

```jsonc
// req
{ "assetId": "uuid", "remoteFileId": "1XyZ...", "thumbUploaded": true }
// res 200
{ "status": "ready" }
```
Drive에서 `files.get`으로 파일 존재와 크기를 검증한 뒤 `status='ready'`로 전환한다. 이 검증이 없으면 클라이언트가 거짓 완료를 보고해 유령 에셋이 생긴다.

실패 보고는 `POST /uploads/fail { assetId, errorCode }` → `status='failed'`.

### 2.5 `POST /downloads/ticket`

```jsonc
// req
{ "assetIds": ["uuid", "..."] }        // 최대 100
// res 200
{
  "tickets": [
    { "assetId": "uuid", "url": "https://<proj>.functions.supabase.co/download?t=eyJ...", "expiresAt": "..." }
  ]
}
```

티켓은 **5분 만료 JWT**로 `{ assetId, userId, spaceId }`를 서명해 담는다. `GET /download?t=...`가 검증 후 Drive에서 스트리밍 중계한다.

| Provider | 처리 |
|---|---|
| Google Drive | 서버가 `files.get?alt=media`를 받아 그대로 파이프(`Range` 헤더 전달) |
| WebDAV | 동일하게 프록시 |
| S3 호환 | **presigned URL을 직접 반환** — 서버 대역폭 0 |

### 2.6 `POST /assets/delete`

```jsonc
{ "assetIds": ["uuid"], "deleteRemote": true }
```
DB에서 `deleted_at` 설정 + 썸네일 삭제 + Drive는 `files.update { trashed: true }`. Phase 1은 영구삭제하지 않는다(복구 가능성 유지).

### 2.7 `POST /notify` (내부 전용)

DB 웹훅으로 `assets` INSERT를 받아 묶음 처리한다. **10분 창으로 debounce**해서 "새 사진 12장"처럼 한 번만 보낸다. 사진 한 장마다 알림이 가면 즉시 알림을 꺼버린다.

---

## 3. StorageProvider 인터페이스

### 3.1 타입

```ts
// src/storage/types.ts
export type ProviderKind = 'google_drive' | 'webdav' | 's3_compatible' | 'naver_mybox';

export interface RemoteRef {
  fileId: string;        // Drive fileId / S3 key / WebDAV 절대경로
  path: string;          // 표시용
}

export interface RemoteEntry extends RemoteRef {
  name: string;
  isFolder: boolean;
  byteSize?: number;
  modifiedAt?: string;
}

export interface UploadSession {
  /** 클라이언트가 바이트를 직접 보낼 대상. null이면 서버 경유 업로드 */
  uploadUrl: string | null;
  chunkSize: number;
  expiresAt: string;
}

/** getSignedUrl을 이 타입으로 통일한다 — Drive/WebDAV에는 서명 URL이 없기 때문 */
export type DownloadTicket =
  | { kind: 'direct'; url: string; expiresAt: string }   // S3 presigned
  | { kind: 'proxy';  url: string; expiresAt: string };  // 우리 Edge Function 경유

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
```

**`getSignedUrl`을 `getDownloadTicket`으로 바꾼 이유:** Drive와 WebDAV에는 만료 서명 URL 개념이 없다. 인터페이스에 `getSignedUrl`을 두면 두 provider가 거짓말을 하거나 예외를 던져야 한다. 반환 타입에 `direct | proxy`를 담으면 클라이언트는 provider를 모른 채 URL만 쓰면 된다.

### 3.2 오류 코드 통일

```ts
export type StorageErrorCode =
  | 'TOKEN_EXPIRED'        // 재인증 필요
  | 'REVOKED'              // 사용자가 권한 철회
  | 'QUOTA_EXCEEDED'       // 저장 공간 부족
  | 'RATE_LIMITED'         // 백오프 후 재시도
  | 'NOT_FOUND'            // 원격 파일 소실 → asset을 orphaned로
  | 'FORBIDDEN'
  | 'NETWORK'
  | 'UNSUPPORTED'          // provider가 해당 기능 미지원
  | 'UNKNOWN';
```

Provider별 매핑:

| 상황 | Drive | WebDAV | S3 |
|---|---|---|---|
| TOKEN_EXPIRED | 401 `invalidCredentials` | 401 | 403 `ExpiredToken` |
| REVOKED | 401 + refresh 실패 `invalid_grant` | 401 지속 | 403 `InvalidAccessKeyId` |
| QUOTA_EXCEEDED | 403 `storageQuotaExceeded` | 507 Insufficient Storage | 이론상 없음 |
| RATE_LIMITED | 403 `userRateLimitExceeded` / 429 | 429 | 503 `SlowDown` |
| NOT_FOUND | 404 | 404 | 404 `NoSuchKey` |

### 3.3 GoogleDriveProvider (Phase 1 정식)

```ts
// supabase/functions/_shared/providers/googleDrive.ts
const DRIVE = 'https://www.googleapis.com/drive/v3';
const UPLOAD = 'https://www.googleapis.com/upload/drive/v3';
const FOLDER_MIME = 'application/vnd.google-apps.folder';

export class GoogleDriveProvider implements StorageProvider {
  readonly kind = 'google_drive' as const;
  constructor(private auth: { getAccessToken(): Promise<string> }) {}

  async createFolder(parentId: string, name: string): Promise<RemoteRef> {
    const r = await this.req(`${DRIVE}/files?fields=id,name`, {
      method: 'POST',
      body: JSON.stringify({ name, mimeType: FOLDER_MIME, parents: [parentId] }),
    });
    return { fileId: r.id, path: name };
  }

  async createUploadSession(i: UploadInput): Promise<UploadSession> {
    const res = await fetch(
      `${UPLOAD}/files?uploadType=resumable&fields=id`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${await this.auth.getAccessToken()}`,
          'Content-Type': 'application/json; charset=UTF-8',
          'X-Upload-Content-Type': i.mimeType,
          'X-Upload-Content-Length': String(i.byteSize),
        },
        body: JSON.stringify({
          name: `${i.assetId}_${i.originalName}`,
          parents: [i.parentFolderId],
        }),
      },
    );
    if (!res.ok) throw toStorageError(res);
    const uploadUrl = res.headers.get('Location');
    if (!uploadUrl) throw new StorageError('UNKNOWN', 'resumable 세션 URI 없음');

    return {
      uploadUrl,
      chunkSize: 8 * 1024 * 1024,          // 8MB = 256KB의 배수
      expiresAt: new Date(Date.now() + 7 * 864e5).toISOString(),
    };
  }

  async getDownloadTicket(ref: RemoteRef, ttlSec: number): Promise<DownloadTicket> {
    // Drive에는 서명 URL이 없다 → 항상 프록시
    return { kind: 'proxy', url: signProxyUrl(ref.fileId, ttlSec), expiresAt: iso(ttlSec) };
  }

  async delete(ref: RemoteRef, opts?: { permanent?: boolean }) {
    if (opts?.permanent) {
      await this.req(`${DRIVE}/files/${ref.fileId}`, { method: 'DELETE' });
    } else {
      await this.req(`${DRIVE}/files/${ref.fileId}`, {
        method: 'PATCH', body: JSON.stringify({ trashed: true }),
      });
    }
  }

  async quota() {
    const r = await this.req(`${DRIVE}/about?fields=storageQuota`);
    return { limit: Number(r.storageQuota.limit ?? 0) || null, usage: Number(r.storageQuota.usage) };
  }
}
```

**클라이언트 청크 업로드 (SDK 54, `expo-file-system/legacy`):**

```ts
// src/storage/uploadChunked.ts
import * as FileSystem from 'expo-file-system/legacy';   // 진행률 콜백이 legacy에만 있음

export async function uploadResumable(
  session: UploadSession,
  fileUri: string,
  byteSize: number,
  onProgress: (sent: number, total: number) => void,
  signal?: AbortSignal,
) {
  let offset = await queryOffset(session.uploadUrl!, byteSize);   // 재개 지점 조회

  while (offset < byteSize) {
    const end = Math.min(offset + session.chunkSize, byteSize) - 1;
    const task = FileSystem.createUploadTask(
      session.uploadUrl!,
      fileUri,
      {
        httpMethod: 'PUT',
        uploadType: FileSystem.FileSystemUploadType.BINARY_CONTENT,
        headers: { 'Content-Range': `bytes ${offset}-${end}/${byteSize}` },
      },
      (p) => onProgress(offset + p.totalBytesSent, byteSize),
    );
    const res = await task.uploadAsync();

    if (res?.status === 308) {            // 계속
      offset = parseRange(res.headers['Range']) + 1;
    } else if (res && res.status >= 200 && res.status < 300) {
      return JSON.parse(res.body).id;     // Drive fileId
    } else {
      throw toStorageError(res);
    }
  }
}
```

> **주의:** SDK 54의 `createUploadTask`는 파일 전체를 보낸다. 진짜 청크 전송을 하려면 파일을 잘라 임시 파일로 쓰거나(디스크 낭비), `fetch` + `Blob.slice()`로 직접 보내야 한다(진행률 없음).
> **Phase 1 결정:** 파일 크기 ≤ 50MB는 **단일 PUT + `createUploadTask` 진행률**로 처리하고, 50MB 초과(주로 영상)만 `fetch` + `Blob.slice()` 청크 전송에 **청크 단위 진행률**(청크 완료마다 갱신)을 쓴다. 사진은 대부분 10MB 미만이라 이 분기로 충분하다.

### 3.4 폴더 미러링 전략

앱 폴더 트리와 Drive 폴더가 1:1로 대응한다.

```
앱: 박씨네 > 2026 > 여름휴가 > 제주
Drive: /FamilyShare/{spaceId}/2026/여름휴가/제주
```

- `folders.drive_folder_id`에 Drive 폴더 ID를 캐시한다. 없으면 **경로를 따라 없는 폴더만 생성**(`ensurePath`).
- 앱에서 폴더 이름 변경 → Drive `files.update { name }`.
- 앱에서 폴더 이동 → Drive `files.update?addParents=&removeParents=`.
- **사용자가 Drive 웹에서 폴더를 옮겨도 앱은 정상 동작한다** — ID 기준이라 경로가 달라져도 파일을 찾는다. `path` 컬럼은 표시용이므로 어긋나도 기능이 깨지지 않는다.
- 사용자가 Drive에서 파일을 지우면 `files.get`이 404 → 해당 asset을 `orphaned`로 표시하고 그리드에서 "원본이 삭제됨" 배지로 보여준다.

### 3.5 WebDAV / S3 Provider (Phase 2 스텁)

```ts
export class WebDAVProvider implements StorageProvider {
  readonly kind = 'webdav' as const;
  // createFolder → MKCOL
  // list        → PROPFIND (Depth: 1)
  // upload      → PUT (resumable 없음. 실패 시 처음부터 재시도)
  // download    → GET, 항상 { kind: 'proxy' }
  // delete      → DELETE
  // quota       → PROPFIND quota-available-bytes (서버가 지원할 때만)
}

export class S3CompatibleProvider implements StorageProvider {
  readonly kind = 's3_compatible' as const;
  // createFolder → no-op (프리픽스는 가상)
  // list        → ListObjectsV2 (delimiter '/')
  // upload      → CreateMultipartUpload + presigned part URL → 클라이언트 직행
  // download    → getSignedUrl → { kind: 'direct' }   ← 서버 대역폭 0
  // delete      → DeleteObject
  // quota       → null (S3에 용량 개념 없음)
}
```

**S3가 WebDAV보다 구조적으로 우월하다** — presigned URL 덕분에 업로드·다운로드 모두 서버를 거치지 않는다. NAS 온보딩에서 S3 호환(MinIO / Synology S3)을 먼저 권장한다.

### 3.6 MyboxProvider — 구현하지 않는다

```ts
// src/storage/providers/mybox.ts
/**
 * 네이버 MYBOX는 제3자 애플리케이션용 공개 파일 API가 없다.
 * 2026-07-14 네이버가 구 API를 종료했고 신규 API는 외부 개발사에 미공개.
 * 근거: docs/phase0-storage-feasibility.md §0.3
 *
 * 비공식 API·리버스엔지니어링 연동은 ToS 위반이자 스토어 리젝 사유이므로 구현하지 않는다.
 * 네이버가 공식 API를 공개하면 이 파일을 StorageProvider 구현으로 교체한다.
 */
export const MYBOX_STATUS = {
  available: false,
  reason: 'NO_PUBLIC_THIRD_PARTY_API',
  uiMessage: '네이버 공식 API 공개를 기다리는 중입니다. 공개되면 바로 지원할게요.',
} as const;
```

---

## 4. 토큰 수명 관리

```
[기기]                    [Edge Function]                [Google]
  │ serverAuthCode ────────→ │
  │                          │ code 교환 ────────────────→ │
  │                          │ ←──────── access + refresh  │
  │                          │ refresh → Vault 저장         │
  │ ←──── connectionId ───── │
  │                          │
  │ 업로드 세션 요청 ────────→ │ Vault에서 refresh 복호화     │
  │                          │ access token 갱신 ─────────→ │
  │                          │ (60분 캐시, KV 또는 메모리)   │
  │ ←──── uploadUrl ──────── │
  │                          │
  │ 바이트 전송 ──────────────────────────────────────────→ │  ← 서버 경유 없음
```

- **기기는 refresh token을 절대 갖지 않는다.** access token조차 필요 없다(업로드 세션 URI만 받는다).
- refresh 실패(`invalid_grant`) → `storage_connections.last_error='revoked'` → 모든 멤버 화면에 재연결 배너. 업로드 큐는 **일시정지**하고 삭제하지 않는다.
- access token은 만료 5분 전 선제 갱신한다.

---

## 5. 레이트리밋 / 재시도 정책

| 대상 | 정책 |
|---|---|
| Drive API 429/403 rateLimit | 지수 백오프 + 지터, 1s → 2s → 4s → 8s → 16s, 최대 5회 |
| 동시 업로드 | 기기당 **3개**로 제한 (모바일 대역폭·발열) |
| 업로드 큐 재개 | 앱 재시작 시 `status IN ('pending','uploading')` 항목을 큐에 복원 |
| 다운로드 티켓 | 요청당 최대 100건, 5분 만료 |
| 푸시 debounce | 10분 창, 스페이스당 1건으로 묶음 |

`Retry-After` 헤더가 있으면 그 값을 우선한다.
