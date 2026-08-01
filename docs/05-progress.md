# 05 — 진행 상태 & 다음 작업

최종 갱신: 2026-08-01

---

## 완료

| 산출물 | 상태 | 파일 |
|---|---|---|
| 1. 스토리지 선체크 + GO/NO-GO | ✅ | `docs/phase0-storage-feasibility.md` |
| 2. PRD 요약 | ✅ | `docs/01-prd-and-flows.md` |
| 3. 화면 플로우 | ✅ | `docs/01-prd-and-flows.md` §5 |
| 4. ERD | ✅ | `docs/02-erd-and-rls.md` §1–2 |
| 5. API 명세 | ✅ | `docs/03-api-and-storage-provider.md` §2 |
| 6. StorageProvider 설계 | ✅ | `docs/03-api-and-storage-provider.md` §3 |
| 7. iOS 백그라운드 설계 | ✅ | `docs/04-background-upload.md` |
| 8. 보안·RLS | ✅ | `docs/02-erd-and-rls.md` §3–6 |
| 9. 프로젝트 구조 | 🟡 진행 중 | 아래 참조 |
| 10. Phase 1 코드 | ⬜ 미착수 | |
| 11. Phase별 완료 체크리스트 | 🟡 부분 | `docs/02` §7, `docs/04` §7 |

### 확정 결정 (사용자 승인)
- **Google Drive**: 계획대로 Phase 1 착수. 스토어 제출·프로덕션 OAuth 검수 **전** Google 서면 조회를 릴리즈 게이트로 둔다.
- **Expo SDK 54 고정** (`AGENTS.md`를 v54 문서 기준으로 수정 완료).
- **백엔드 Supabase**.
- 썸네일만 Supabase Storage에 보관, 원본은 사용자 클라우드 전용 (`docs/02` §0).

---

## 현재 코드 상태

### 완료된 스캐폴딩
```
app.json                     expo-router · scheme · 권한 · config plugin 설정
babel.config.js              babel-preset-expo + react-native-worklets/plugin
tsconfig.json                strict, @/* → ./src/*
package.json                 main: expo-router/entry, typecheck 스크립트 추가
.env.example                 필요한 환경 변수 전부 문서화

app/_layout.tsx              루트 Stack + SafeAreaProvider
app/index.tsx                자리표시자 (세션 분기로 교체 예정)

src/lib/config.ts            환경 변수 · DRIVE_SCOPES · UPLOAD_LIMITS
src/lib/supabase.ts          클라이언트 + AppState 토큰 갱신 제어 + callFunction
src/lib/theme.ts             색·간격·타이포
src/lib/database.types.ts    DB 타입 (마이그레이션과 손으로 동기화)

src/storage/types.ts         StorageProvider · DownloadTicket · UploadSession
src/storage/errors.ts        StorageError · 한국어 문구 · 백오프
src/storage/client.ts        Edge Function 호출 래퍼 (연결/업로드/다운로드/삭제)
src/storage/providers/mybox.ts   MYBOX·NAS 비활성 상태 상수 + 미구현 근거
```

`npx tsc --noEmit` **통과** (exit 0).

### 설치된 의존성
`expo-router` `expo-secure-store` `expo-sqlite` `expo-image` `expo-image-picker`
`expo-media-library` `expo-file-system` `expo-background-task` `expo-task-manager`
`expo-notifications` `expo-crypto` `expo-linking` `expo-constants`
`@supabase/supabase-js` `@react-native-async-storage/async-storage`
`@react-native-google-signin/google-signin` `react-native-url-polyfill`
`react-native-safe-area-context` `react-native-screens` `react-native-gesture-handler`
`react-native-reanimated` `expo-splash-screen` `typescript`

> `App.js`와 `index.js`는 삭제했다. expo-router가 `app/` 디렉터리를 진입점으로 쓴다.

---

## 다음 작업 (순서대로)

### A. 백엔드 (코드보다 먼저 필요)
1. Supabase 프로젝트 생성 → `.env` 채우기
2. `supabase/migrations/0001_init.sql` 작성 — `docs/02` §2·§3의 DDL과 RLS를 그대로 옮긴다
3. `docs/02` §7의 **검증 체크리스트 15개**를 통과시킨다 (Phase 1 완료 게이트)
4. Google Cloud Console: Drive API 활성화, OAuth 클라이언트 3종(웹/iOS/Android) 생성,
   동의 화면에 `drive.file` 스코프 등록

### B. Edge Functions (`supabase/functions/`)
- `_shared/googleDrive.ts` — `docs/03` §3.3의 GoogleDriveProvider
- `_shared/tokens.ts` — Vault 복호화 + access token 60분 캐시
- `storage-connect` / `storage-disconnect`
- `uploads-create-session` / `uploads-complete` / `uploads-fail`
- `downloads-ticket` / `download`
- `assets-delete`
- `notify` (DB 웹훅, 10분 debounce)

### C. 클라이언트
1. `src/auth/` — Google Sign-In(`offlineAccess: true`, `forceCodeForRefreshToken: true`) + 세션 Provider
2. `src/queue/db.ts` + `queue.ts` — `docs/04` §6의 SQLite 스키마, 동시 3개, 재개 지원
3. `src/storage/uploadResumable.ts` — 50MB 이하 단일 PUT(`expo-file-system/legacy` 진행률),
   초과 시 `fetch` + `Blob.slice()` 청크
4. 화면 — `docs/01` §5 플로우 순서대로:
   로그인 → 스페이스 목록/생성 → 저장소 연결 → 초대/수락 → 폴더 브라우저 →
   업로드 → 사진 상세 → 다운로드 → 멤버·역할

### D. 릴리즈 전 필수
- [ ] Google에 use case 서면 조회 후 회신 보관 (`docs/phase0` §0.2 H)
- [ ] `docs/02` §7 RLS 검증 15개 전부 통과
- [ ] 개인정보처리방침에 썸네일 서버 보관 사실 명시
- [ ] EAS 개발 빌드로 실기기 검증 (Expo Go 불가)

---

## 알려진 미해결 사항

1. **`app.json`의 딥링크 도메인이 자리표시자다** (`familyshare.example.com`).
   실제 도메인이 정해지면 `associatedDomains` / `intentFilters` / `EXPO_PUBLIC_INVITE_BASE_URL`을 함께 고친다.
2. **`src/lib/database.types.ts`는 손으로 작성했다.** 마이그레이션 확정 후
   `npx supabase gen types typescript`로 재생성해 교체한다.
3. **SDK 54 업로드 진행률은 legacy API에만 있다.** 업로드 경로는
   `expo-file-system/legacy`의 `createUploadTask`를 쓰고, 신 API(`File`/`Directory`)는
   캐시·썸네일 처리에만 쓴다.
4. `npm audit`에 취약점 16건(moderate 14, high 2)이 있다. 전부 전이 의존성이며
   Phase 1 착수 전에 한 번 정리할 것.
