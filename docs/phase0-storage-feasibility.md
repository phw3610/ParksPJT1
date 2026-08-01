# Phase 0 — 스토리지 구현 가능 여부 선체크

- 작성일: 2026-08-01
- 판정 기준: 공식 개발자 문서 / 서비스 약관 / 공식 공지만 사용. 비공식 구현·리버스 API는 근거로 사용하지 않음.
- 대상: 1차 Google Drive, 2차 네이버 MYBOX, 3차 개인 NAS

---

## 0.5 선체크 결과 표

| 순위 | 스토리지 | 판정 | 인증 방식 | 모바일 적합 | 약관 리스크 | 권장 Phase | 엔지니어링 착수 순서 | 대안 |
|------|----------|------|-----------|-------------|-------------|------------|----------------------|------|
| 1차 | Google Drive | **조건부 가능** (기술 100% 가능 / ToS 확인 1건) | OAuth 2.0 + PKCE, `drive.file` (비민감 스코프) | 적합 (iOS·Android 공식 지원) | **중** — Drive API ToS 금지 사례 중 "developer's app에서 Drive로의 백업" 조항 해석 필요 | Phase 1 | **1** | 없음 (1차는 대체 불가). Google Photos API는 대안 불가 |
| 2차 | 네이버 MYBOX | **현재 불가** | 해당 없음 (제3자용 파일 API 부재) | 해당 없음 | **높음** — 공개 API 없음, 비공식 연동은 ToS·스토어 위반 | 보류 (Phase 2 NO-GO) | **보류** | UI "연동 준비 중" 플레이스홀더 + 알림 신청, 네이버 제휴 문의 |
| 3차 | 개인 NAS | **조건부 가능** (WebDAV / S3 호환 = 가능, SFTP = 현재 불가) | WebDAV: Basic/Digest over HTTPS + 앱 비밀번호<br>S3 호환: Access Key / Secret | 조건부 적합 (사용자 NAS 설정 의존) | **낮음** — 사용자 소유 인프라, 제3자 약관 없음 | **Phase 2로 승격** | **2** | SFTP 미지원 시 WebDAV 권장 안내 |

**Phase 1 범위 확정 문장:**
> Phase 1은 **Google Drive만 정식 지원**한다. NAS는 MYBOX 불가 판정에 따라 2차 슬롯을 대체해 **Phase 2**에서 WebDAV + S3 호환으로 구현하고, MYBOX는 **약관·API 공개 확인 중 상태로 UI에만 존치**한다.

**2차 슬롯 UI 존치 제안:** 존치한다. 제품 우선순위 표기(1 Drive / 2 MYBOX / 3 NAS)는 유지하되, MYBOX 카드는 비활성 + "네이버 공식 API 공개 대기 중" 문구 + "공개되면 알림 받기" 버튼(이메일 수집)으로 둔다. 이유: 국내 사용자 기대치가 실재하고, 네이버가 신규 API를 외부에 공개할 경우 즉시 활성화할 수 있으며, 수요 데이터를 제휴 문의 근거로 쓸 수 있다.

---

## 0.2 1차 — Google Drive

### A~M 체크리스트

| 항목 | 판정 | 근거 |
|------|------|------|
| A. 공식 API 존재 | **YES** | Google Drive API v3 (files, folders, permissions, changes) |
| B. 제3자 모바일 앱에서 업로드/다운로드/삭제/목록 | **YES** | `files.create`(업로드), `files.get?alt=media`(다운로드), `files.delete`, `files.list` 전부 공개 REST |
| C. 인증 방식 | OAuth 2.0 Authorization Code + PKCE | 네이티브 앱 표준 플로우 |
| D. 모바일 OAuth·커스텀 스킴·PKCE | **YES** | iOS/Android OAuth 클라이언트 + 역방향 클라이언트 ID 리다이렉트, PKCE S256 |
| E. 필요 스코프 | `https://www.googleapis.com/auth/drive.file` 단독으로 충분 | 아래 스코프 표 참조 |
| F. 대용량·resumable 업로드 | **YES** | `uploadType=resumable`, 세션 URI, 256KB 배수 청크, 세션 1주 유효 |
| G. 서명 URL / 권한 위임 | **조건부** — Drive에 시간제한 서명 URL 개념 없음. `permissions.create`로 계정/링크 단위 공유 또는 앱 프록시 다운로드 | `permissions.create`는 `drive.file` 스코프로 호출 가능 (확인됨) |
| H. ToS — 가족 공유 앱 + 메타데이터 서버 조합 | **주의 필요** | 아래 "H 상세" 참조 |
| I. 요금·쿼터 | Drive API 무료, 사용자 Drive 용량 소진 시 `storageQuotaExceeded`. 쿼터는 프로젝트/사용자 단위 레이트리밋 | |
| J. 스토어 심사 | Google Play 사진·동영상 권한 정책(Android 13+ 세분화 권한), App Store 사진 접근 목적 고지 | `expo-media-library`가 Android 13+ `photo`/`video` 세분 권한 지원 |
| K. 한국 개인정보·아동 사진 | 고지 필요 — 개인정보처리방침에 "원본은 사용자 클라우드에만 저장, 서버는 메타데이터만" 명시. 만 14세 미만 법정대리인 동의 요건 검토 | |
| L. **결론** | **조건부 가능** | 기술 장애 없음. 유일 변수는 ToS 해석 |
| M. 권장 Phase / 대안 | **Phase 1 GO (기술 착수)**, 프로덕션 OAuth 검수 제출 전 Google 서면 확인 | 대안 없음 |

### 근거 3줄 요약
1. Drive API v3는 폴더 생성·resumable 업로드·목록·삭제·권한 부여를 모두 공개 REST로 제공하며, 우리가 필요한 전 기능이 **비민감 스코프 `drive.file` 하나로 커버**된다 — OAuth 제한 스코프 검수·보안 감사(CASA) 불필요.
2. `drive.file`은 "앱이 만들었거나 사용자가 앱에 연 파일"만 접근 — `/FamilyShare/{spaceId}/` 앱 전용 루트 전략과 정확히 일치하고, 최소 권한 원칙을 자동 충족한다.
3. 단, Drive API ToS의 금지 사례에 **"Backup of user or app content from a developer's app or project to Drive"**가 명시되어 있고 이는 스코프와 무관하게 적용된다 — 특히 "iOS 지정 앨범 자동 업로드" 기능이 이 조항으로 읽힐 소지가 있어 사전 확인이 필요하다.

### E 상세 — 스코프 선택

| 스코프 | 민감도 | 검수 | 채택 |
|--------|--------|------|------|
| `drive.file` | **비민감(Non-sensitive)** | OAuth 브랜드 검증만, 제한 스코프 검수/보안 감사 불필요 | ✅ **채택** |
| `drive.appdata` | 비민감 | 불필요 | ❌ 숨김 폴더라 사용자가 Drive에서 사진을 볼 수 없음 → 제품 취지 위반 |
| `drive` | **제한(Restricted)** | 제한 스코프 검수 + 제3자 보안 감사(CASA) 필수, 연간 비용·기간 발생 | ❌ 불필요 |
| `drive.readonly` / `drive.metadata` | 제한 | 동일 | ❌ 불필요 |

→ **최종: `drive.file` 단독.** 사용자 동의 화면에는 "이 앱이 만든 파일만 접근"으로 표시되어 신뢰도도 유리.

### H 상세 — ToS 리스크 (Phase 1 최대 변수)

Drive API ToS "Customer Implementation" 절에 다음이 **Google의 사전 서면 동의 없이 금지**로 명시됨:

> "Backup of user or app content from a developer's app or project to Drive."

- 해석 A (안전): 우리 앱은 **사용자가 자기 사진을 자기 Drive에 정리·공유**하는 사용자 주도 파일 관리 도구다. "developer's app content"의 백업이 아니다.
- 해석 B (위험): 기기 사진을 앱이 자동으로 Drive에 올리는 **백업 성격**으로 읽힐 수 있다. 특히 §2.6 "iOS 지정 앨범 백그라운드 자동 업로드"는 자동 백업 그 자체로 보인다.

**완화 전략 (설계에 반영 필수):**
1. 제품 포지셔닝·UI 카피에서 "백업" 용어를 쓰지 않는다 → "가족 앨범에 올리기", "공유 폴더에 동기화".
2. 수동 업로드(사용자 선택)를 기본으로 하고, 자동 업로드는 **명시적 옵트인 + 대상 앨범 지정** 형태로 제한한다.
3. 앱 안에서 Drive 파일을 **열람·정리·공유하는 UI가 주 기능**임을 OAuth 동의 화면 심사 자료에 명확히 제출한다.
4. **프로덕션 OAuth 검수 제출 전, Google Workspace API 지원 채널로 use case를 서면 조회**하고 회신을 보관한다.
5. 최악의 경우(자동 업로드 불가 회신) → §2.6은 NAS 백엔드에서만 제공하고 Drive는 수동 업로드만 유지. 이 경우에도 Phase 1 MVP는 성립한다.

**GO/NO-GO: 기술 착수 GO.** 위 5번 폴백이 존재하므로 Phase 1이 통째로 무산되지 않는다. 단 스토어 제출 전 4번 완료를 릴리즈 게이트로 둔다.

### G 상세 — 다운로드 경로 설계 (Drive에는 서명 URL이 없다)

Drive는 S3식 만료 서명 URL을 제공하지 않는다. 멤버별 다운로드는 두 가지 중 선택:

| 방식 | 동작 | 장점 | 단점 | 채택 |
|------|------|------|------|------|
| **(1) 소유자 토큰 프록시** | 파일 I/O를 스페이스 Owner의 Drive 계정으로만 수행. 멤버 요청은 백엔드 Edge Function이 Owner 토큰으로 대행 스트리밍 | 멤버가 Google 계정 없어도 됨, 접근 통제를 앱 RLS로 일원화 | Owner refresh token을 서버에 암호화 보관해야 함, 대역폭 비용이 우리 서버에 발생 | ✅ **Phase 1 채택** |
| (2) Drive permissions 위임 | `permissions.create`로 멤버 이메일에 `reader` 부여 후 `webContentLink` 전달 | 서버 대역폭 0 | 멤버 전원 Google 계정 필수, 앱에서 강퇴해도 Drive 권한 회수 누락 위험, 파일당 권한 API 호출 폭증 | ❌ (Phase 3 옵션) |

→ Phase 1은 (1). 원본 URL은 절대 클라이언트에 노출하지 않고, 백엔드가 발급한 **단기 서명 다운로드 티켓**(자체 JWT, 5분 만료)으로 대행한다.

### 4) 앱 전용 루트 경로 규칙

```
/FamilyShare/                       ← 앱이 최초 1회 생성 (Owner Drive 루트 하위)
  /{spaceId}/                       ← 스페이스별 루트
    /{folderPath...}/               ← 앱 폴더 트리와 1:1 미러링 (중첩 무제한)
      /{assetUuid}_{originalName}   ← 파일명 충돌 회피
```
- Drive 폴더 ID는 `folders.drive_folder_id`에 캐싱해 매 요청 조회를 피한다.
- 사용자가 Drive 웹에서 폴더를 옮기거나 지워도 앱은 ID 기준으로 동작한다(경로는 표시용).
- `drive.file` 스코프이므로 앱이 만든 이 트리 외부는 애초에 접근 불가 = 사고 시 피해 범위 한정.

### 5) 토큰 저장 / 재인증 UX
- 기기: `expo-secure-store` (iOS Keychain / Android Keystore)에 access token만.
- 서버: Owner의 refresh token은 프록시 다운로드에 필요 → Supabase Vault 또는 KMS 암호화 컬럼에 저장, 서비스 롤만 복호화. `offlineAccess: true` + `forceCodeForRefreshToken: true`로 `serverAuthCode`를 받아 백엔드에서 교환.
- refresh 실패(사용자 권한 철회, 비밀번호 변경) → 스페이스 상단 배너 "Google Drive 연결이 만료되었습니다. 다시 연결해 주세요" + 업로드 큐 일시정지(삭제 아님).

### 6) 에러 코드별 UX

| HTTP / reason | 상황 | UI 카피 | 동작 |
|---|---|---|---|
| 401 `invalidCredentials` | 토큰 만료 | "Google Drive 재연결이 필요합니다" | refresh 시도 → 실패 시 재인증 유도 |
| 403 `storageQuotaExceeded` | Drive 용량 부족 | "Google Drive 저장 공간이 가득 찼습니다" | 업로드 큐 일시정지, Drive 용량 관리 링크 |
| 403 `userRateLimitExceeded` / 429 | 레이트리밋 | (무음) | 지수 백오프 재시도, 최대 5회 |
| 403 `insufficientFilePermissions` | 권한 부족 | "이 파일에 접근할 수 없습니다" | 해당 asset만 실패 표시 |
| 404 | Drive에서 파일 삭제됨 | "원본이 Drive에서 삭제되었습니다" | asset을 `orphaned` 상태로 마킹 |
| 5xx | 일시 장애 | (무음) | 백오프 재시도 |

### Google Photos API는 대안이 되지 않음
2025-03-31부로 `photoslibrary.readonly` / `photoslibrary.sharing` / `photoslibrary` 스코프가 제거되어, Library API는 **자기 앱이 업로드한 미디어만** 다룰 수 있고 공유 앨범 API는 403을 반환한다. 선택은 Picker API로만 가능. 따라서 Google Photos 기반 가족 앨범은 구현 불가이며, Drive가 유일한 Google 경로다.

---

## 0.3 2차 — 네이버 MYBOX

### A~M 체크리스트

| 항목 | 판정 | 근거 |
|------|------|------|
| A. 공식 API 존재 | **NO** | 네이버 Open API 공식 목록: 로그인, 프로필, 검색(블로그·뉴스·책·영화·지역·쇼핑·이미지 등), 파파고 번역, 클로바 음성/비전, 지도·지오코딩, 블로그·카페·캘린더 작성, 단축URL, 캡차, 데이터랩. **클라우드 스토리지·파일 API 없음** |
| B. 제3자 앱 업로드/다운로드/삭제/목록 | **NO** | 위와 동일 |
| C. 인증 방식 | 해당 없음 | 네이버 로그인 OAuth는 존재하나 **MYBOX 파일 스코프가 존재하지 않음** |
| D. 모바일 OAuth | 해당 없음 | |
| E. 스코프 | 해당 없음 | |
| F. resumable 업로드 | 해당 없음 | |
| G. 공유 링크 / 권한 위임 | 사용자가 MYBOX 앱에서 수동 공유 링크 생성만 가능 (앱 자동화 불가) | |
| H. ToS | **위반 리스크 높음** — 문서화된 API가 없으므로 어떤 연동도 비공식 경로 |
| I. 요금·쿼터 | 해당 없음 |
| J. 스토어 심사 | 비공식 API 사용 시 리젝 및 계정 제재 리스크 |
| K. 개인정보 | 해당 없음 |
| L. **결론** | **현재 불가** | |
| M. 권장 Phase / 대안 | **보류.** 대안 2-2 채택(우선순위 표기는 유지, 기능은 비활성) + 대안 2-3(제휴 문의) | |

### 근거 3줄 요약
1. 네이버 개발자센터 Open API 목록 어디에도 MYBOX·클라우드 스토리지·파일 업로드/다운로드 API가 없다. 존재하는 콘텐츠 작성 API는 블로그·카페·캘린더뿐이다.
2. **2026-07-14부로 RaiDrive의 네이버 MYBOX 연결 서비스가 중단**되었고, 사유는 "네이버가 기존 구(舊) API 서비스를 종료했으며 신규 API가 아직 외부 개발사에 공개되지 않음"이다. 즉 과거 비공식 경로마저 닫혔고, 신규 API는 제3자 공개 전이다.
3. GitHub의 "MYBOX API" 구현체는 개인 토이 프로젝트(비공식 리버스)로 제품 근거가 될 수 없으며, 지시서 규칙(§0.6, §6)에 따라 사용 금지 대상이다.

### 3) 판정 분기 결과
- (A) 공식 제3자 파일 API + 허용 약관 → **해당 없음**
- (B) 개인 액세스 토큰만 존재 + 약관 모호 → **해당 없음** (개인 액세스 토큰 발급 경로 자체가 공식 문서에 확인되지 않음)
- (C) **공개 API 없음 / 제3자 연동 경로 없음 → 채택. Phase 2 NO-GO.**

> 지시서 §0.3의 "2026년 보도 기준 개인 액세스 토큰 방향" 언급은 공식 소스로 확인되지 않았다. 확인된 것은 정반대 방향의 사실(구 API 종료, 신규 API 미공개)뿐이다. 향후 네이버가 공식 발표할 경우 이 문서를 재검증한다.

### 4) 대안 (제품에 명시)
- **대안 2-1 (수동 안내)**: ❌ 비채택. 사용자가 MYBOX 앱에서 폴더 공유 링크를 만들어 붙여넣는 방식은 앱이 파일 목록·썸네일·다운로드를 제어할 수 없어 제품 경험이 깨진다. 지시서도 비권장.
- **대안 2-2 (슬롯 유지 + 비활성)**: ✅ **채택**. 우선순위 표기 1 Drive / 2 MYBOX / 3 NAS는 유지하고, 엔지니어링 착수 순서만 Drive → NAS → MYBOX로 조정. MYBOX 카드는 "네이버 공식 API 공개 대기 중" + 알림 신청.
- **대안 2-3 (제휴 문의 체크리스트)**: ✅ 병행. 아래 참조.

**네이버 제휴/비즈니스 문의 체크리스트**
1. 문의 대상: 네이버 클라우드 MYBOX 사업 담당 / 네이버 개발자센터 문의 채널
2. 질의 항목:
   - 제3자 애플리케이션용 MYBOX 파일 API(업로드/다운로드/폴더/목록) 공개 계획 및 시점
   - 네이버 로그인 OAuth에 MYBOX 파일 스코프 추가 계획 유무
   - 개인 액세스 토큰이 존재한다면 제3자 상용 앱에서의 사용이 이용약관상 허용되는지
   - 파트너/제휴 API 프로그램 존재 여부 및 신청 요건
   - RaiDrive 등에 종료 통보된 구 API의 대체 경로 안내 여부
3. 회신은 문서로 보관하고 이 파일에 날짜와 함께 반영한다.

### 5) 금지 사항 재확인
비공식 API 스크래핑, 모바일 앱 프로토콜 리버스엔지니어링, 웹 세션 쿠키 재사용 방식의 MYBOX 연동은 **구현하지 않는다.** (ToS 위반 + 스토어 리젝 + 사용자 계정 제재 리스크)

### 6) Phase 2 GO/NO-GO
**NO-GO (보류).** 상태 표기: **보류**. Phase 2 슬롯은 NAS가 대체한다.

---

## 0.4 3차 — 개인 NAS

### 1) 프로토콜별 가능표

| 프로토콜 | 인증 | 업로드 | 다운로드 | 삭제 | 폴더 생성 | 서명 URL | RN/Expo 클라이언트 | 판정 |
|---|---|---|---|---|---|---|---|---|
| **WebDAV** | Basic/Digest over HTTPS, 앱 비밀번호 | PUT | GET | DELETE | MKCOL | ❌ (프록시 필요) | `webdav` npm — RN 엔트리 존재, Metro/babel 모듈 리졸버 설정 필요 | ✅ **가능 — MVP 채택** |
| **S3 호환** (MinIO, Synology S3, QNAP) | Access Key / Secret (SigV4) | PUT / Multipart Upload | GET | DELETE | 프리픽스(가상) | ✅ **presigned URL 네이티브 지원** | `@aws-sdk/client-s3` + `@aws-sdk/s3-request-presigner`, RN crypto 폴리필 필요 | ✅ **가능 — MVP 채택** |
| **SFTP** | 키/비밀번호 | ✅ | ✅ | ✅ | ✅ | ❌ | `react-native-ssh-sftp` 최신 배포가 수년째 정체, Expo 호환 config plugin 없음 | ❌ **현재 불가 (후순위)** |
| **SMB** | NTLM 등 | — | — | — | — | ❌ | 모바일 클라이언트 부재, 방화벽·인증 복잡도 높음 | ❌ 제외 |

**최소 지원 세트 제안: MVP NAS = WebDAV + S3 호환.** 이 둘로 Synology / QNAP / MinIO / TrueNAS 대부분을 커버하며, 두 프로토콜 모두 순수 JS 클라이언트로 Expo 개발 빌드에서 동작한다. SFTP는 유지보수되는 RN 라이브러리가 나오거나 자체 config plugin을 작성할 여력이 생길 때 Phase 3+로 미룬다.

### 2) iOS ATS / 인증서
- 기본 정책: **신뢰된 CA 인증서 HTTPS만 허용.** Let's Encrypt + DDNS 조합을 온보딩에서 안내(Synology DSM은 내장 지원).
- 자체 서명 인증서: `NSAllowsArbitraryLoads` 예외는 App Store 심사에서 정당화 요구 + 보안 후퇴 → **지원하지 않는다.** 대신 "인증서 발급 방법" 가이드 링크 제공.
- 평문 HTTP: 차단. 온보딩에서 `http://` 입력 시 즉시 오류.

### 3) 로컬 LAN vs 외부 접속
- LAN 전용 설정은 집 밖에서 앱이 동작하지 않음 → 온보딩에서 명확히 경고.
- 권장 순서: ① DDNS + 리버스 프록시 + 신뢰 인증서 ② VPN(WireGuard/Tailscale) ③ LAN 전용(경고 표시).
- 포트 포워딩을 직접 여는 방식은 위험 고지와 함께 최후 옵션으로만 안내.

### 4) 다중 멤버 접근 보안 모델

**권장: Owner 단일 연결 + 서버 대행 (Drive와 동일한 모델).**

| 모델 | 설명 | 판정 |
|---|---|---|
| **Owner 연결 + 백엔드 대행** | Owner만 NAS 자격증명 등록 → 백엔드가 암호화 보관 → 멤버의 업로드/다운로드는 백엔드가 대행 | ✅ **채택.** 멤버가 NAS 자격증명을 알 필요 없음, 강퇴 시 즉시 차단, 앱 RLS가 단일 진실 공급원 |
| 멤버별 NAS 계정 | 각 멤버가 자기 NAS 계정 입력 | ❌ Owner가 가족 전원 NAS 계정을 만들어야 함, 온보딩 이탈률 치명적 |
| 공유 자격증명 배포 | Owner 자격증명을 멤버 기기에 배포 | ❌ 금지. 강퇴해도 자격증명이 남고, 앱 밖에서 NAS 전체 접근 가능 |

**명문화할 보안 규칙**
- NAS 자격증명은 **NAS의 전용 앱 계정/앱 비밀번호**로만 등록하도록 강제 안내 (관리자 계정 금지, 해당 공유 폴더만 권한 부여).
- 백엔드 저장 시 KMS/Vault 암호화, 서비스 롤만 복호화, 평문 로그 금지.
- 멤버 기기에는 자격증명을 **절대** 내려보내지 않는다. 다운로드는 백엔드가 발급한 5분 만료 티켓으로만.
- S3 호환의 경우 presigned URL을 백엔드에서 생성해 만료 5분으로 내려보내면 대역폭을 NAS가 직접 부담 → 우리 서버 비용 절감. **S3 호환이 WebDAV보다 구조적으로 우월하므로 온보딩에서 S3를 먼저 권장.**

### 5) 결론
**조건부 가능 (사용자 NAS 설정 의존).** MYBOX가 불가이므로 **Phase 2로 승격**, 엔지니어링 착수 순서 2번.

---

## StorageProvider 메서드 매핑 가능 여부

인터페이스:
```ts
interface StorageProvider {
  connect(config): Promise<Connection>
  upload(file, path, { onProgress, signal }): Promise<RemoteRef>
  list(path): Promise<RemoteEntry[]>
  delete(remoteRef): Promise<void>
  getSignedUrl(remoteRef, ttlSec): Promise<string>   // 없으면 downloadStream으로 폴백
  createFolder(path): Promise<RemoteFolderRef>
}
```

| 메서드 | GoogleDrive | WebDAV | S3 호환 | MYBOX |
|---|---|---|---|---|
| `connect` | ✅ OAuth2 + PKCE | ✅ URL + 자격증명 검증(PROPFIND) | ✅ 키 검증(ListBuckets/HeadBucket) | ❌ |
| `upload` (진행률) | ✅ resumable, 256KB 배수 청크, `Content-Range` | ✅ PUT + `expo-file-system` `createUploadTask().onProgress` | ✅ Multipart Upload (5MB+ 파트) | ❌ |
| `list` | ✅ `files.list?q='{folderId}' in parents` | ✅ PROPFIND Depth:1 | ✅ ListObjectsV2 + delimiter | ❌ |
| `delete` | ✅ `files.delete` (또는 `trashed=true` 권장) | ✅ DELETE | ✅ DeleteObject | ❌ |
| `getSignedUrl` | ⚠️ **미지원** → 백엔드 프록시 + 자체 5분 티켓으로 폴백 | ⚠️ **미지원** → 동일 폴백 | ✅ **네이티브 presigned URL** | ❌ |
| `createFolder` | ✅ `files.create` (mimeType `application/vnd.google-apps.folder`) | ✅ MKCOL | ✅ 프리픽스 (실제 객체 불필요) | ❌ |

→ `getSignedUrl`이 Drive·WebDAV에서 없으므로, 인터페이스를 **`getDownloadTicket()`으로 통일**하고 내부에서 provider별로 presigned URL 또는 백엔드 프록시를 선택하게 한다. 이렇게 하면 클라이언트 코드가 provider를 몰라도 된다.

---

## 확정 결정 (2026-08-01, 사용자 승인)

| 항목 | 결정 | 비고 |
|------|------|------|
| Drive ToS 대응 | **계획대로 Phase 1 착수 + 릴리즈 게이트** | 스토어 제출·프로덕션 OAuth 검수 전 Google 서면 조회 완료를 필수 게이트로 둔다. 회신이 부정적이면 자동 업로드만 NAS 전용으로 축소(폴백 확보됨) |
| 모바일 스택 | **Expo SDK 54 유지** (`expo ~54.0.34`, RN 0.81.5) | `AGENTS.md`의 v57 링크를 v54로 수정함. 이하 모든 API는 v54 기준 |
| 백엔드 | **Supabase** (Auth, Postgres+RLS, Realtime, Edge Functions, Vault) | 푸시는 FCM + APNs를 Edge Function에서 직접 호출 |

### 백엔드가 필요한 이유 (Drive 단독이 불가능한 근거)
1. Drive 공유 권한은 Google 계정 단위 → 가족 전원 Gmail 필수, 앱 자체 초대(링크/QR) 불가.
2. `drive.file` 스코프는 "앱이 만든 파일 + Picker로 연 파일"만 접근 → 다른 멤버가 올린 사진 목록을 자동으로 못 읽는다. 읽으려면 제한 스코프 `drive` 필요 → CASA 보안감사 발생.
3. Drive 변경 감지(`changes.watch`)는 **공개 HTTPS 웹훅 수신처 필수** → 실시간을 하려는 순간 서버가 필요.
4. FCM/APNs 푸시는 디바이스 토큰을 보관한 서버가 발송한다. 클라이언트끼리 불가.
5. 강퇴 시 Drive permission을 파일마다 회수해야 하고 한 건만 실패해도 접근이 남는다 → 앱 DB 멤버십 한 줄로 차단하는 것과 신뢰도가 다르다.

원본 사진은 서버를 거치지 않는다. **업로드는 기기 → Drive 직행**, 서버는 다운로드 중계와 메타/실시간/푸시만 담당한다.

---

## Expo SDK 54 기준 API 확인 결과

| 필요 기능 | SDK 54 모듈 | 상태 | 주의 |
|---|---|---|---|
| Drive OAuth | `@react-native-google-signin/google-signin` (config plugin) | ✅ | `offlineAccess: true` + `forceCodeForRefreshToken: true`로 `serverAuthCode` 수령 → 백엔드에서 refresh token 교환. `webClientId`는 **WEB 타입** 클라이언트 ID여야 함. Expo 공식 문서도 Google 인증은 `expo-auth-session` 대신 이 라이브러리를 권장 |
| 업로드 진행률 | `expo-file-system/legacy`의 `createUploadTask()` + `onProgress` | ⚠️ **legacy 경로 사용** | SDK 54의 신 API(`File`/`Directory`/`Paths`)에는 업로드 진행률 콜백이 없다. 진행률 UI가 필수 요구사항(§P1)이므로 업로드만 legacy import를 쓴다 |
| 파일 읽기/쓰기 | `expo-file-system` 신 API (`File`, `Directory`, `Paths`) | ✅ | 캐시·썸네일 관리에 사용 |
| 앨범 읽기 | `expo-media-library` (`Album.get`, `album.getAssets`) | ✅ | Android 13+ 세분 권한(`photo`/`video`), iOS 14+ `limited` 접근 처리 필요 |
| 카메라롤 저장 | `expo-media-library` (`Asset.create(filePath, album)`) | ✅ | Android는 미지정 시 Pictures로 저장 |
| 백그라운드 태스크 | `expo-background-task` | ✅ SDK 54 포함 | `minimumInterval` 기본 12시간, **최소 15분**. iOS는 `UIBackgroundModes: [processing]` 필요(CNG prebuild가 자동 주입). **시뮬레이터 불가, 실기기 전용** |
| 시크릿 저장 | `expo-secure-store` | ✅ | Keychain / Keystore |
| 사진 선택 | `expo-image-picker` | ✅ | |
| 푸시 | `expo-notifications` | ✅ | |
| 로컬 큐 DB | `expo-sqlite` | ✅ | 업로드 큐 영속화 |

**Expo Go로는 개발 불가.** Google Sign-In 네이티브 모듈과 백그라운드 처리 모드 주입 때문에 **EAS 개발 빌드가 필수**다. 이는 SDK 54 유지와 무관한 제약이다.

---

## 부수 발견 — iOS 백그라운드 업로드의 실제 한계

`expo-media-library`의 `addListener`는 **앱이 실행 중일 때만** 발화한다. 시스템이 백그라운드에서 사진 앨범 변경을 앱에 통지하는 iOS API는 존재하지 않는다.

따라서 §2.6 "지정 앨범 백그라운드 자동 업로드"는 다음 **최선 노력(best-effort)** 구조로만 구현 가능하다:
1. `expo-background-task`가 OS 재량으로 앱을 깨울 때(최소 15분, 실제로는 훨씬 드묾)
2. + 앱이 포그라운드로 진입할 때
3. → `lastProcessedAt` 이후 생성된 지정 앨범의 신규 에셋을 diff해서 업로드 큐에 넣는다.

설정 화면에 "iOS 제약으로 즉시 업로드는 보장되지 않으며, 앱을 열면 밀린 사진이 함께 올라갑니다"를 고지한다. Android는 WorkManager 기반이라 상대적으로 안정적이다.

---

## Phase 착수 규칙 (선체크 반영 최종)

- **Phase 1**: Google Drive만 정식 `StorageProvider`. E2E 업로드/다운로드/실시간. MYBOX·NAS는 UI에 비활성 카드로 노출.
- **Phase 2**: `WebDAVProvider` + `S3CompatibleProvider` (MYBOX 불가로 승격). 댓글·반응·읽음·휴지통·즐겨찾기.
- **Phase 3**: iOS 앨범 감시 백그라운드 업로드 + Android WorkManager 동등 기능, 일괄 다운로드 고도화. `SftpProvider`는 라이브러리 상황 재평가 후 결정.
- **보류**: `MyboxProvider` — 네이버 공식 제3자 파일 API 공개 시 재검증 후 착수.
- 사용자가 스토리지 미연결 시 업로드 버튼 차단 + 연결 유도.
- 스페이스당 기본 스토리지 1개. 폴더별 오버라이드는 Phase 4+ 옵션.

---

## 출처

- [Google Drive API — Manage uploads (simple / multipart / resumable)](https://developers.google.com/workspace/drive/api/guides/manage-uploads)
- [Google Drive API — Choose Drive API scopes](https://developers.google.com/workspace/drive/api/guides/api-specific-auth)
- [Google Drive API — Share files, folders and drives](https://developers.google.com/workspace/drive/api/guides/manage-sharing)
- [Google Drive API — permissions.create reference (scopes)](https://developers.google.com/workspace/drive/api/reference/rest/v3/permissions/create)
- [Google Drive API Terms of Service](https://developers.google.com/workspace/drive/api/terms)
- [Google Workspace API user data and developer policy (Limited Use)](https://developers.google.com/workspace/workspace-api-user-data-developer-policy)
- [Restricted scope verification](https://developers.google.com/identity/protocols/oauth2/production-readiness/restricted-scope-verification)
- [Google Photos APIs — Picker API launch and Library API changes](https://developers.googleblog.com/en/google-photos-picker-api-launch-and-library-api-updates/)
- [Updates to the Google Photos APIs](https://developers.google.com/photos/support/updates)
- [네이버 오픈 API 목록 (naver-openapi-guide)](https://naver.github.io/naver-openapi-guide/apilist.html)
- [RaiDrive 공지 — 네이버 마이박스 연결 서비스 일시 중단 (2026-07-14)](https://ko-with.raidrive.com/t/topic/7388)
- [Expo SDK 54 — API 목록](https://docs.expo.dev/versions/v54.0.0/)
- [Expo SDK 54 — FileSystem (File/Directory 신 API + legacy createUploadTask)](https://docs.expo.dev/versions/v54.0.0/sdk/filesystem/)
- [Expo SDK 54 — BackgroundTask (minimumInterval, UIBackgroundModes)](https://docs.expo.dev/versions/v54.0.0/sdk/background-task/)
- [Expo SDK 57 — MediaLibrary (모듈 API는 54와 동일)](https://docs.expo.dev/versions/v57.0.0/sdk/media-library/)
- [Expo SDK 57 — AuthSession (PKCE, Google은 전용 라이브러리 권장)](https://docs.expo.dev/versions/v57.0.0/sdk/auth-session/)
- [Expo — Using Google authentication](https://docs.expo.dev/guides/google-authentication/)
- [expo-background-task (BGTaskScheduler / WorkManager)](https://docs.expo.dev/versions/latest/sdk/background-task/)
- [webdav npm (React Native 엔트리)](https://www.npmjs.com/package/webdav)
