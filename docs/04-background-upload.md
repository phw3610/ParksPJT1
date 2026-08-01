# 04 — 지정 앨범 자동 업로드 설계 (iOS / Android)

Phase 3 기능. 설계는 지금 확정하고, 데이터 모델(`lastProcessedAt` 등)은 Phase 1 스키마에 미리 넣는다.

> **용어 규칙:** UI와 코드 어디에도 "백업"이라는 단어를 쓰지 않는다. Google Drive API ToS가 "앱→Drive 백업"을 사전 서면동의 없이 금지하기 때문이다([Phase 0 §0.2 H](./phase0-storage-feasibility.md)). 사용할 표현: **"지정 앨범 자동 올리기"**, **"새 사진 자동 추가"**.

---

## 1. iOS의 실제 제약 — 먼저 인정할 것

**시스템이 백그라운드에서 사진 앨범 변경을 앱에 통지하는 iOS API는 존재하지 않는다.**

- `PHPhotoLibraryChangeObserver` (= `expo-media-library`의 `addListener`)는 **앱 프로세스가 살아 있을 때만** 발화한다.
- `BGTaskScheduler`는 배터리·네트워크·사용 패턴을 보고 OS가 **재량으로** 앱을 깨운다. 최소 간격을 지정해도 그건 "이보다 빨리는 안 깨움"이라는 하한일 뿐, 실제로는 하루에 몇 번 수준이거나 아예 안 깨울 수도 있다.
- `expo-background-task`의 `minimumInterval`은 기본 12시간, **최소 15분**. iOS 시뮬레이터에서는 아예 동작하지 않는다.

**따라서 "사진을 찍는 즉시 올라간다"는 iOS에서 구현 불가능하다.** 이걸 약속하는 UI를 만들면 안 된다.

Android는 `WorkManager` 기반이라 훨씬 안정적이지만, Doze 모드와 제조사별 배터리 최적화(특히 삼성·샤오미)로 지연될 수 있다.

---

## 2. 채택 구조 — 3중 트리거 + diff

정확한 시점 통지를 포기하고, **여러 기회에 밀린 것을 몰아서 처리**하는 구조로 간다.

```
              ┌──────────────────────────────────────┐
              │        syncNewAssets(spaceId)        │
              │  1. 지정 앨범에서 createdAfter 조회   │
              │  2. 이미 올린 localId 제외            │
              │  3. 필터(날짜/영상/해시) 적용          │
              │  4. 업로드 큐에 삽입                  │
              │  5. lastProcessedAt 갱신              │
              └──────────────────────────────────────┘
                    ↑            ↑            ↑
        ┌───────────┘            │            └───────────┐
   [트리거 A]                [트리거 B]                [트리거 C]
  포그라운드 진입           BGTask 기상               앱 실행 중
  (AppState active)      (15분~수시간, OS 재량)    MediaLibrary.addListener
      가장 확실              iOS 보조 수단             즉시 반응
```

**트리거 A(포그라운드 진입)가 실질적 주력이다.** 사용자가 앱을 열면 밀린 사진이 즉시 올라가기 시작한다. B와 C는 보너스다.

---

## 3. diff 알고리즘

```ts
// src/autoupload/sync.ts
import * as MediaLibrary from 'expo-media-library';

export async function syncNewAssets(cfg: AutoUploadConfig): Promise<number> {
  const { spaceId, albumId, targetFolderId, lastProcessedAt,
          includeVideos, cellularAllowed, minCapturedAt } = cfg;

  const perm = await MediaLibrary.getPermissionsAsync();
  if (!perm.granted) return 0;
  // iOS 14+ 제한 접근(limited)이면 사용자가 고른 사진만 보인다 — 설정에서 안내
  if (perm.accessPrivileges === 'limited') markLimitedAccess();

  const page = await MediaLibrary.getAssetsAsync({
    album: albumId,
    mediaType: includeVideos
      ? [MediaLibrary.MediaType.photo, MediaLibrary.MediaType.video]
      : [MediaLibrary.MediaType.photo],
    createdAfter: lastProcessedAt,          // ← diff의 핵심
    sortBy: [[MediaLibrary.SortBy.creationTime, true]],  // 오름차순
    first: 200,                             // BGTask 실행 시간이 짧으므로 배치 제한
  });

  let queued = 0;
  let maxSeen = lastProcessedAt;

  for (const a of page.assets) {
    maxSeen = Math.max(maxSeen, a.creationTime);

    if (minCapturedAt && a.creationTime < minCapturedAt) continue;
    if (await alreadyQueued(a.id)) continue;              // localId 기준 1차 방어
    const hash = await quickHash(a);                      // 크기+생성시각+파일명
    if (await hashExists(spaceId, hash)) continue;        // 2차 방어(재설치 대비)

    await enqueueUpload({ localId: a.id, uri: a.uri, spaceId,
                          folderId: targetFolderId, hash,
                          capturedAt: a.creationTime, cellularAllowed });
    queued++;
  }

  // 배치를 다 못 끝냈어도 진행한 만큼은 커밋한다 (다음 실행이 이어받음)
  await saveLastProcessedAt(spaceId, maxSeen);
  return queued;
}
```

### 중복 방지 3단
| 단계 | 기준 | 막는 상황 |
|---|---|---|
| 1 | 로컬 `localId` 테이블 | 같은 기기에서 재실행 |
| 2 | `quickHash` (byteSize + creationTime + fileName) | 앱 재설치, 기기 변경 |
| 3 | `content_hash` (sha256, Phase 2) | 다른 멤버가 같은 사진을 올림 |

1·2단은 SQLite 로컬, 3단은 서버 `assets.content_hash` 인덱스로 판정한다. sha256을 모든 사진에 대해 계산하면 배터리를 크게 먹으므로, 1·2단을 통과한 것만 계산한다.

---

## 4. 플랫폼별 등록 코드

### 4.1 태스크 정의 (공통)

```ts
// src/autoupload/task.ts
import * as TaskManager from 'expo-task-manager';
import * as BackgroundTask from 'expo-background-task';

export const AUTO_UPLOAD_TASK = 'family-share-auto-upload';

TaskManager.defineTask(AUTO_UPLOAD_TASK, async () => {
  try {
    const configs = await loadEnabledConfigs();
    for (const cfg of configs) {
      if (!(await networkAllowed(cfg))) continue;   // Wi-Fi only 옵션
      await syncNewAssets(cfg);
      await drainQueue({ maxSeconds: 20 });         // BGTask 실행 창은 짧다
    }
    return BackgroundTask.BackgroundTaskResult.Success;
  } catch {
    return BackgroundTask.BackgroundTaskResult.Failed;
  }
});

export async function enableAutoUpload() {
  const status = await BackgroundTask.getStatusAsync();
  if (status === BackgroundTask.BackgroundTaskStatus.Restricted) {
    throw new Error('BACKGROUND_RESTRICTED');   // 저전력 모드 / 설정에서 차단
  }
  await BackgroundTask.registerTaskAsync(AUTO_UPLOAD_TASK, {
    minimumInterval: 15,        // 분. iOS는 이보다 훨씬 드물게 실행된다
  });
}
```

### 4.2 app.json (SDK 54)

```jsonc
{
  "expo": {
    "plugins": [
      ["expo-media-library", {
        "photosPermission": "가족 앨범에 사진을 올리기 위해 사진 접근 권한이 필요해요.",
        "savePhotosPermission": "받은 사진을 기기에 저장하기 위해 권한이 필요해요.",
        "isAccessMediaLocationEnabled": true
      }],
      ["expo-background-task"]
    ],
    "ios": {
      "infoPlist": {
        "UIBackgroundModes": ["processing", "fetch", "remote-notification"]
      }
    },
    "android": {
      "permissions": [
        "READ_MEDIA_IMAGES",
        "READ_MEDIA_VIDEO",
        "ACCESS_NETWORK_STATE"
      ]
    }
  }
}
```

`expo-background-task` config plugin이 iOS의 `BGTaskSchedulerPermittedIdentifiers`를 prebuild 때 주입한다. CNG를 쓰지 않고 `ios/` 디렉터리를 직접 관리한다면 수동으로 넣어야 한다 — **이게 "등록했는데 한 번도 안 돌아요"의 1순위 원인이다.**

### 4.3 포그라운드 트리거

```ts
// src/autoupload/foreground.ts
import { AppState } from 'react-native';
import * as MediaLibrary from 'expo-media-library';

export function installForegroundTriggers() {
  // 트리거 A — 포그라운드 진입 (주력)
  const sub = AppState.addEventListener('change', (s) => {
    if (s === 'active') void runSyncForAllSpaces();
  });

  // 트리거 C — 앱 실행 중 앨범 변경 (즉시 반응)
  const mlSub = MediaLibrary.addListener(({ hasIncrementalChanges, insertedAssets }) => {
    if (hasIncrementalChanges && insertedAssets?.length) void runSyncForAllSpaces();
  });

  return () => { sub.remove(); mlSub.remove(); };
}
```

---

## 5. 설정 화면 — 고지 문구 확정

```
 ┌─────────────────────────────────────────────┐
 │ 자동 올리기                                   │
 ├─────────────────────────────────────────────┤
 │ 자동 올리기                          [ ●  ]  │
 │                                             │
 │ 감시할 앨범           가족사진        >      │
 │ 올릴 폴더            2026 > 자동      >      │
 ├─────────────────────────────────────────────┤
 │ Wi-Fi에서만 올리기                   [ ●  ]  │
 │ 동영상도 올리기                      [   ○ ] │
 │ 이 날짜 이후 사진만    2026.01.01     >      │
 ├─────────────────────────────────────────────┤
 │ ℹ️ iOS 제약으로 사진이 바로 올라가지          │
 │    않을 수 있어요. 앱을 열면 밀린 사진이       │
 │    함께 올라갑니다.                          │
 │                                             │
 │ 마지막 확인: 오늘 오후 2:31 · 12장 추가됨     │
 └─────────────────────────────────────────────┘
```

**"마지막 확인" 표시가 중요하다.** iOS에서 자동 실행이 드물다는 사실을 숨기면 사용자는 "고장났다"고 판단한다. 마지막 동작 시각을 노출하면 앱을 열어서 해결할 수 있다는 걸 학습한다.

`BackgroundTaskStatus.Restricted`인 경우 추가 배너:
> "저전력 모드이거나 백그라운드 앱 새로고침이 꺼져 있어요. 설정 > 일반 > 백그라운드 앱 새로고침에서 켜 주세요." + [설정 열기]

---

## 6. Phase 1에 미리 넣을 것

Phase 3 기능이지만 **스키마와 큐 구조는 Phase 1에서 확정**해야 나중에 마이그레이션을 안 한다.

로컬 SQLite (`expo-sqlite`):

```sql
create table if not exists upload_queue (
  id            text primary key,
  space_id      text not null,
  folder_id     text,
  local_id      text,                    -- MediaLibrary asset id (자동 올리기용)
  file_uri      text not null,
  original_name text not null,
  mime_type     text not null,
  byte_size     integer not null,
  captured_at   integer,
  quick_hash    text,
  asset_id      text,                    -- 서버가 발급한 assets.id
  upload_url    text,                    -- Drive resumable 세션 URI
  bytes_sent    integer not null default 0,
  status        text not null default 'pending',  -- pending|uploading|done|failed|paused
  attempts      integer not null default 0,
  last_error    text,
  source        text not null default 'manual',   -- manual|auto
  created_at    integer not null
);
create index if not exists idx_queue_status on upload_queue (status, created_at);
create unique index if not exists idx_queue_local on upload_queue (space_id, local_id)
  where local_id is not null;

create table if not exists auto_upload_config (
  space_id         text primary key,
  enabled          integer not null default 0,
  album_id         text,
  target_folder_id text,
  include_videos   integer not null default 0,
  wifi_only        integer not null default 1,
  min_captured_at  integer,
  last_processed_at integer not null default 0,
  last_run_at      integer,
  last_run_count   integer
);
```

`source` 컬럼으로 수동/자동을 구분하면, 자동 올리기가 폭주할 때 수동 업로드를 우선 처리할 수 있다.

---

## 7. 검증 방법 (실기기 필수)

| # | 항목 | 방법 |
|---|---|---|
| 1 | BGTask 등록 확인 | `BackgroundTask.getStatusAsync()` → `Available` |
| 2 | 태스크 강제 실행 | `triggerTaskWorkerForTestingAsync()` (개발 빌드) |
| 3 | iOS 실제 기상 | 실기기에서 24시간 방치 후 `last_run_at` 확인 |
| 4 | diff 정확성 | 앨범에 3장 추가 → 앱 포그라운드 → 정확히 3장만 큐 삽입 |
| 5 | 중복 방지 | 앱 재설치 후 동기화 → 0장 추가 |
| 6 | Wi-Fi only | 셀룰러에서 대기, Wi-Fi 연결 시 재개 |
| 7 | 큐 영속성 | 업로드 중 앱 강제 종료 → 재실행 시 이어서 진행 |
| 8 | limited 접근 | iOS에서 "일부 사진만 허용" 선택 → 안내 배너 표시 |

**시뮬레이터에서는 1~3번을 검증할 수 없다.** Phase 3 착수 전에 실기기와 개발 빌드가 준비돼 있어야 한다.
