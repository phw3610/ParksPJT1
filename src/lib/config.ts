/**
 * 환경 설정. EXPO_PUBLIC_ 접두사가 붙은 값만 클라이언트 번들에 포함된다.
 * 비밀 값(Google client secret, FCM 키 등)은 절대 여기 두지 않는다 — Edge Function 전용.
 */

function required(name: string, value: string | undefined): string {
  if (!value) {
    throw new Error(
      `환경 변수 ${name}이 설정되지 않았습니다. .env 파일을 확인해 주세요 (.env.example 참고).`,
    );
  }
  return value;
}

export const config = {
  supabase: {
    url: required('EXPO_PUBLIC_SUPABASE_URL', process.env.EXPO_PUBLIC_SUPABASE_URL),
    anonKey: required('EXPO_PUBLIC_SUPABASE_ANON_KEY', process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY),
  },
  google: {
    /** Google Cloud Console의 **웹** 클라이언트 ID. iOS/Android용이 아니다. */
    webClientId: required('EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID', process.env.EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID),
    /** iOS 클라이언트 ID (iOS 빌드에만 필요) */
    iosClientId: process.env.EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID,
  },
  /** 초대 링크 도메인. Universal Link / App Link 설정과 일치해야 한다. */
  inviteBaseUrl: process.env.EXPO_PUBLIC_INVITE_BASE_URL ?? 'https://familyshare.example.com/invite',
} as const;

/** Drive에 요구하는 스코프. drive.file은 비민감 스코프라 제한 스코프 검수가 불필요하다. */
export const DRIVE_SCOPES = ['https://www.googleapis.com/auth/drive.file'] as const;

export const UPLOAD_LIMITS = {
  /** 동시 업로드 수. 모바일 대역폭과 발열을 고려한 값. */
  concurrency: 3,
  /** 이 크기 이하는 단일 PUT + 진행률, 초과는 청크 전송. */
  singleShotMaxBytes: 50 * 1024 * 1024,
  /** Drive resumable 청크는 256KB의 배수여야 한다. */
  chunkSize: 8 * 1024 * 1024,
  maxAttempts: 5,
  /** 썸네일 최대 변 길이 */
  thumbMaxEdge: 512,
} as const;
