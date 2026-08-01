# Expo HAS CHANGED

This project is pinned to **Expo SDK 54** (`expo ~54.0.34`, React Native 0.81.5).
Read the exact versioned docs at https://docs.expo.dev/versions/v54.0.0/ before writing any code.
Do not use APIs from newer SDKs without upgrading `package.json` first.

## Project

가족 공유앨범 앱. 사진 원본은 사용자가 연결한 외부 스토리지(BYO storage)에만 저장하고,
앱 백엔드(Supabase)는 메타데이터·권한·실시간·푸시만 담당한다.

스토리지 착수 순서는 **Google Drive → 개인 NAS(WebDAV/S3) → 네이버 MYBOX(보류)**.
판정 근거와 제약은 `docs/phase0-storage-feasibility.md`를 먼저 읽을 것.
네이버 MYBOX는 공개 API가 없으므로 비공식 API·리버스엔지니어링 연동을 구현하지 않는다.

Expo Go로는 개발할 수 없다. Google Sign-In 네이티브 모듈과 백그라운드 처리 모드 때문에
EAS 개발 빌드가 필수다.
