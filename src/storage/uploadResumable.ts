import { createUploadTask, FileSystemUploadType } from 'expo-file-system/legacy';

import { UPLOAD_LIMITS } from '@/lib/config';

export interface UploadResumableInput {
  uploadUrl: string;
  fileUri: string;
  mimeType: string;
  byteSize: number;
  onProgress?: (bytesSent: number, totalBytes: number) => void;
}

export interface UploadResumableResult {
  remoteFileId: string;
}

export async function uploadResumable(
  input: UploadResumableInput
): Promise<UploadResumableResult> {
  const { uploadUrl, fileUri, mimeType, byteSize, onProgress } = input;

  if (byteSize <= UPLOAD_LIMITS.singleShotMaxBytes) {
    // 50MB 이하: expo-file-system/legacy 의 createUploadTask 활용 (SDK 54 진행률 API)
    const task = createUploadTask(
      uploadUrl,
      fileUri,
      {
        httpMethod: 'PUT',
        uploadType: FileSystemUploadType.BINARY_CONTENT,
        headers: {
          'Content-Type': mimeType,
          'Content-Length': String(byteSize),
        },
      },
      (data) => {
        if (onProgress) {
          onProgress(data.totalBytesSent, data.totalBytesExpectedToSend);
        }
      }
    );

    const result = await task.uploadAsync();

    if (!result || (result.status !== 200 && result.status !== 201)) {
      throw new Error(
        `업로드 실패 (HTTP ${result?.status ?? 'UNKNOWN'}): ${result?.body ?? ''}`
      );
    }

    let parsed: { id?: string } = {};
    try {
      parsed = JSON.parse(result.body);
    } catch {
      /* 무시 */
    }

    return {
      remoteFileId: parsed.id ?? '',
    };
  }

  // 50MB 초과: fetch + Blob.slice() 청크 업로드
  const response = await fetch(fileUri);
  const blob = await response.blob();
  const chunkSize = UPLOAD_LIMITS.chunkSize;
  let start = 0;
  let remoteFileId = '';

  while (start < byteSize) {
    const end = Math.min(start + chunkSize, byteSize);
    const chunk = blob.slice(start, end);

    const res = await fetch(uploadUrl, {
      method: 'PUT',
      headers: {
        'Content-Type': mimeType,
        'Content-Length': String(end - start),
        'Content-Range': `bytes ${start}-${end - 1}/${byteSize}`,
      },
      body: chunk,
    });

    if (res.status === 200 || res.status === 201) {
      const data = (await res.json()) as { id?: string };
      remoteFileId = data.id ?? '';
      start = end;
      if (onProgress) onProgress(start, byteSize);
      break;
    } else if (res.status === 308) {
      // Resume Incomplete - 정상 청크 수신
      start = end;
      if (onProgress) onProgress(start, byteSize);
    } else {
      const errText = await res.text();
      throw new Error(`청크 업로드 실패 (HTTP ${res.status}): ${errText}`);
    }
  }

  return { remoteFileId };
}
