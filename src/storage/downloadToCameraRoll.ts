import * as FileSystem from 'expo-file-system/legacy';
import * as MediaLibrary from 'expo-media-library';

import { getDownloadTickets } from '@/storage/client';

export type CameraRollDownloadErrorCode =
  | 'PERMISSION_DENIED'
  | 'TICKET_FAILED'
  | 'DOWNLOAD_FAILED'
  | 'SAVE_FAILED';

export class CameraRollDownloadError extends Error {
  constructor(
    readonly code: CameraRollDownloadErrorCode,
    message: string,
    readonly httpStatus?: number
  ) {
    super(message);
    this.name = 'CameraRollDownloadError';
  }
}

export interface DownloadItem {
  assetId: string;
  fileName?: string;
}

export interface DownloadBatchResult {
  succeeded: string[];
  failed: Array<{ assetId: string; error: CameraRollDownloadError }>;
}

function getExtension(filename?: string): string {
  if (!filename) return 'jpg';
  const parts = filename.split('.');
  if (parts.length > 1) {
    const ext = parts.pop()?.toLowerCase() ?? '';
    if (ext && /^[a-z0-9]+$/i.test(ext)) {
      return ext;
    }
  }
  return 'jpg';
}

/**
 * 미디어 라이브러리 쓰기(저장) 권한 확인 및 요청.
 * writeOnly = true 옵션을 전달하여 저장에 필요한 최소 권한만 요청한다.
 */
export async function ensureMediaLibraryWritePermission(): Promise<void> {
  const perm = await MediaLibrary.getPermissionsAsync(true);
  if (perm.granted) return;

  const req = await MediaLibrary.requestPermissionsAsync(true);
  if (!req.granted) {
    throw new CameraRollDownloadError(
      'PERMISSION_DENIED',
      '카메라롤에 저장하기 위한 미디어 라이브러리 접근 권한이 필요합니다.'
    );
  }
}

/**
 * 단일 티켓 URL을 로컬 임시 파일로 다운로드 후 카메라롤에 저장.
 * 성공 여부와 관계없이 임시 파일을 삭제한다.
 */
export async function downloadTicketToCameraRoll(
  ticketUrl: string,
  fileName?: string
): Promise<void> {
  if (!FileSystem.cacheDirectory) {
    throw new CameraRollDownloadError(
      'SAVE_FAILED',
      '임시 저장소 경로를 찾을 수 없습니다.'
    );
  }

  const ext = getExtension(fileName);
  const tempFileName = `download_${Date.now()}_${Math.random().toString(36).substring(2, 8)}.${ext}`;
  const tempUri = `${FileSystem.cacheDirectory}${tempFileName}`;

  try {
    let downloadRes: FileSystem.FileSystemDownloadResult;
    try {
      downloadRes = await FileSystem.downloadAsync(ticketUrl, tempUri);
    } catch (err: any) {
      throw new CameraRollDownloadError(
        'DOWNLOAD_FAILED',
        `사진 다운로드 실패: ${err?.message || '네트워크 오류'}`
      );
    }

    if (downloadRes.status < 200 || downloadRes.status >= 300) {
      throw new CameraRollDownloadError(
        'DOWNLOAD_FAILED',
        `사진 다운로드 실패 (HTTP ${downloadRes.status})`,
        downloadRes.status
      );
    }

    try {
      await MediaLibrary.saveToLibraryAsync(tempUri);
    } catch (err: any) {
      throw new CameraRollDownloadError(
        'SAVE_FAILED',
        `카메라롤 저장 실패: ${err?.message || '저장 오류'}`
      );
    }
  } finally {
    try {
      const info = await FileSystem.getInfoAsync(tempUri);
      if (info.exists) {
        await FileSystem.deleteAsync(tempUri, { idempotent: true });
      }
    } catch {
      /* 임시 파일 정리 실패 무시 */
    }
  }
}

/**
 * 단일 에셋 다운로드 및 카메라롤 저장.
 */
export async function downloadSingleAssetToCameraRoll(
  assetId: string,
  fileName?: string
): Promise<void> {
  // 1. 권한 확인 (쓰기 전용)
  await ensureMediaLibraryWritePermission();

  // 2. 티켓 발급
  let tickets: Array<{ assetId: string; url: string }>;
  try {
    const res = await getDownloadTickets([assetId]);
    tickets = res.tickets;
  } catch (err: any) {
    throw new CameraRollDownloadError(
      'TICKET_FAILED',
      `다운로드 티켓 발급 실패: ${err?.message || '서버 오류'}`
    );
  }

  if (!tickets || tickets.length === 0 || !tickets[0].url) {
    throw new CameraRollDownloadError(
      'TICKET_FAILED',
      '다운로드 티켓을 발급받지 못했습니다.'
    );
  }

  // 3. 다운로드 및 저장
  await downloadTicketToCameraRoll(tickets[0].url, fileName);
}

/**
 * 다중 에셋 다운로드 및 카메라롤 저장 (추후 다중 선택 기능 연동 대비).
 */
export async function downloadAssetsToCameraRoll(
  items: DownloadItem[]
): Promise<DownloadBatchResult> {
  if (items.length === 0) {
    return { succeeded: [], failed: [] };
  }

  // 1. 권한 확인 (쓰기 전용)
  await ensureMediaLibraryWritePermission();

  // 2. 티켓 일괄 발급
  const assetIds = items.map((item) => item.assetId);
  const ticketMap = new Map<string, string>();
  try {
    const res = await getDownloadTickets(assetIds);
    for (const t of res.tickets) {
      ticketMap.set(t.assetId, t.url);
    }
  } catch (err: any) {
    throw new CameraRollDownloadError(
      'TICKET_FAILED',
      `다운로드 티켓 발급 실패: ${err?.message || '서버 오류'}`
    );
  }

  const succeeded: string[] = [];
  const failed: Array<{ assetId: string; error: CameraRollDownloadError }> = [];

  // 3. 에셋별 순차 다운로드 및 저장
  for (const item of items) {
    const ticketUrl = ticketMap.get(item.assetId);
    if (!ticketUrl) {
      failed.push({
        assetId: item.assetId,
        error: new CameraRollDownloadError(
          'TICKET_FAILED',
          '해당 에셋의 다운로드 티켓이 없습니다.'
        ),
      });
      continue;
    }

    try {
      await downloadTicketToCameraRoll(ticketUrl, item.fileName);
      succeeded.push(item.assetId);
    } catch (err) {
      if (err instanceof CameraRollDownloadError) {
        failed.push({ assetId: item.assetId, error: err });
      } else {
        failed.push({
          assetId: item.assetId,
          error: new CameraRollDownloadError(
            'SAVE_FAILED',
            (err as Error)?.message || '알 수 없는 오류'
          ),
        });
      }
    }
  }

  return { succeeded, failed };
}
