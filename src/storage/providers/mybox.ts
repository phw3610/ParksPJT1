/**
 * 네이버 MYBOX — 구현하지 않는다.
 *
 * 판정 근거 (docs/phase0-storage-feasibility.md §0.3):
 *  - 네이버 개발자센터 Open API 목록에 클라우드 스토리지/파일 API가 존재하지 않는다.
 *  - 2026-07-14부로 네이버가 구 API를 종료했고, 신규 API는 외부 개발사에 미공개다.
 *  - GitHub의 비공식 구현체는 제품 근거가 될 수 없다.
 *
 * 비공식 API 스크래핑, 앱 프로토콜 리버스엔지니어링, 웹 세션 쿠키 재사용 방식의 연동은
 * ToS 위반이자 스토어 리젝·사용자 계정 제재 사유이므로 **구현하지 않는다.**
 *
 * 네이버가 제3자용 공식 파일 API를 공개하면 이 파일을 StorageProvider 구현으로 교체한다.
 */
export const MYBOX_STATUS = {
  available: false,
  reason: 'NO_PUBLIC_THIRD_PARTY_API',
  title: '네이버 MYBOX',
  uiMessage: '네이버 공식 API 공개를 기다리는 중입니다.\n공개되면 바로 지원할게요.',
  ctaLabel: '공개되면 알림 받기',
  /** 재검증 시각. 네이버 공지를 확인할 때마다 갱신한다. */
  lastCheckedAt: '2026-08-01',
} as const;

export const NAS_STATUS = {
  available: false,
  reason: 'PLANNED_PHASE_2',
  title: '개인 NAS',
  uiMessage: 'WebDAV · S3 호환 저장소를 준비하고 있어요. (Phase 2)',
  lastCheckedAt: '2026-08-01',
} as const;
