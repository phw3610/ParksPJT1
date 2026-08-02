import { UPLOAD_LIMITS } from '@/lib/config';
import { supabase } from '@/lib/supabase';
import { completeUpload, createUploadSession, failUpload } from '@/storage/client';
import {
  backoffMs,
  isRetryable,
  needsReconnect,
  originalErrorDetails,
  userMessage,
} from '@/storage/errors';
import {
  readThumbnailUploadBody,
  readVideoThumbnailUploadBody,
} from '@/storage/thumbnails';
import { uploadResumable } from '@/storage/uploadResumable';

import {
  clearCompletedItems,
  deleteQueueItem,
  enqueueItem,
  getAllItemsForSpace,
  getDatabase,
  getPendingItems,
  hasPausedItems,
  resetUploadingToPending,
  resumePausedItems,
  updateItemStatus,
  UploadQueueItem,
  UploadQueueStatus,
} from './db';

type QueueListener = (items: UploadQueueItem[]) => void;

class QueueManager {
  private activeCount = 0;
  private isPaused = false;
  private listeners: Set<QueueListener> = new Set();
  private initialized = false;

  async init() {
    if (this.initialized) return;
    this.initialized = true;
    await getDatabase();
    // 앱 재시작 시 기존 'uploading' 상태였던 항목을 'pending'으로 복구하여 재개 가능하게 함
    await resetUploadingToPending();
    this.isPaused = await hasPausedItems();
    if (!this.isPaused) this.processQueue();
  }

  subscribe(listener: QueueListener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  private async notifyListeners(spaceId?: string) {
    if (!spaceId) return;
    const items = await getAllItemsForSpace(spaceId);
    this.listeners.forEach((fn) => fn(items));
  }

  pause() {
    this.isPaused = true;
  }

  async resume(spaceId: string) {
    await this.init();
    await resumePausedItems(spaceId);
    this.isPaused = false;
    await this.notifyListeners(spaceId);
    this.processQueue();
  }

  async enqueue(input: {
    spaceId: string;
    folderId: string | null;
    localId?: string | null;
    fileUri: string;
    originalName: string;
    mimeType: string;
    byteSize: number;
    capturedAt?: number | null;
    width?: number | null;
    height?: number | null;
    durationMs?: number | null;
    quickHash?: string | null;
    kind: 'image' | 'video';
    source?: 'manual' | 'auto';
  }): Promise<UploadQueueItem> {
    await this.init();
    const item = await enqueueItem({
      space_id: input.spaceId,
      folder_id: input.folderId,
      local_id: input.localId ?? null,
      file_uri: input.fileUri,
      original_name: input.originalName,
      mime_type: input.mimeType,
      byte_size: input.byteSize,
      captured_at: input.capturedAt ?? null,
      width: input.width ?? null,
      height: input.height ?? null,
      duration_ms: input.durationMs ?? null,
      quick_hash: input.quickHash ?? null,
      source: input.source ?? 'manual',
    });

    await this.notifyListeners(input.spaceId);
    this.processQueue();
    return item;
  }

  async retryItem(id: string, spaceId: string) {
    await updateItemStatus(id, 'pending', {
      attempts: 0,
      last_error: null,
      last_error_code: null,
      last_error_detail: null,
      last_error_status: null,
    });
    await this.notifyListeners(spaceId);
    this.processQueue();
  }

  async removeItem(id: string, spaceId: string) {
    await deleteQueueItem(id);
    await this.notifyListeners(spaceId);
  }

  async clearCompleted(spaceId: string) {
    await clearCompletedItems(spaceId);
    await this.notifyListeners(spaceId);
  }

  private async processQueue() {
    if (this.isPaused) return;
    if (this.activeCount >= UPLOAD_LIMITS.concurrency) return;

    const items = await getPendingItems(UPLOAD_LIMITS.concurrency - this.activeCount);
    if (items.length === 0) return;

    for (const item of items) {
      if (this.activeCount >= UPLOAD_LIMITS.concurrency) break;
      this.activeCount++;
      this.uploadItem(item).finally(() => {
        this.activeCount--;
        this.processQueue();
      });
    }
  }

  private async uploadItem(item: UploadQueueItem) {
    await updateItemStatus(item.id, 'uploading');
    await this.notifyListeners(item.space_id);

    try {
      let assetId = item.asset_id;
      let uploadUrl = item.upload_url;

      // 1. 업로드 세션 발급 (없는 경우)
      if (!assetId || !uploadUrl) {
        const kind = item.mime_type.startsWith('video') ? 'video' : 'image';
        const sessionRes = await createUploadSession({
          spaceId: item.space_id,
          folderId: item.folder_id,
          originalName: item.original_name,
          mimeType: item.mime_type,
          byteSize: item.byte_size,
          capturedAt: item.captured_at ? new Date(item.captured_at).toISOString() : null,
          width: item.width ?? undefined,
          height: item.height ?? undefined,
          durationMs: item.duration_ms ?? undefined,
          contentHash: item.quick_hash ?? undefined,
          kind,
        });

        assetId = sessionRes.assetId;
        uploadUrl = sessionRes.uploadUrl;
        await updateItemStatus(item.id, 'uploading', {
          asset_id: assetId,
          upload_url: uploadUrl,
        });
      }

      if (!uploadUrl) {
        throw new Error('업로드 세션 URL을 발급받지 못했습니다.');
      }

      // 2. 바이트 업로드 (50MB 이하 단일 PUT, 50MB 초과 청크)
      const uploadRes = await uploadResumable({
        uploadUrl,
        fileUri: item.file_uri,
        mimeType: item.mime_type,
        byteSize: item.byte_size,
        onProgress: async (sent, total) => {
          await updateItemStatus(item.id, 'uploading', { bytes_sent: sent });
          await this.notifyListeners(item.space_id);
        },
      });

      // 3. 썸네일 업로드 시도 (사진은 원본을, 영상은 한 프레임을 축소한다)
      let thumbUploaded = false;
      let thumbnailError: ReturnType<typeof originalErrorDetails> | null = null;
      const isVideo = item.mime_type.startsWith('video');
      if (isVideo || item.mime_type.startsWith('image')) {
        try {
          const thumbBody = isVideo
            ? await readVideoThumbnailUploadBody(item.file_uri)
            : await readThumbnailUploadBody(item.file_uri);
          const thumbPath = `${item.space_id}/${assetId}.jpg`;
          const { error: thumbErr } = await supabase.storage
            .from('thumbs')
            .upload(thumbPath, thumbBody, { contentType: 'image/jpeg', upsert: true });

          if (thumbErr) throw thumbErr;
          thumbUploaded = true;
        } catch (error) {
          // 썸네일 실패는 원본 업로드를 막지 않지만 진단 정보는 큐와 개발 로그에 남긴다.
          thumbnailError = originalErrorDetails(error);
          console.error('[upload-queue] Thumbnail upload failed', {
            queueItemId: item.id,
            assetId,
            code: thumbnailError.code,
            message: thumbnailError.message,
            status: thumbnailError.status,
            error,
          });
        }
      }

      // 4. 업로드 완료 보고
      await completeUpload(assetId, uploadRes.remoteFileId, thumbUploaded);
      await updateItemStatus(item.id, 'done', {
        bytes_sent: item.byte_size,
        last_error: thumbnailError
          ? '원본은 올라갔지만 미리보기를 만들지 못했어요.'
          : null,
        last_error_code: thumbnailError?.code ?? null,
        last_error_detail: thumbnailError?.message ?? null,
        last_error_status: thumbnailError?.status ?? null,
      });
      await this.notifyListeners(item.space_id);
    } catch (err: any) {
      const isNeedReconnect = needsReconnect(err);
      const isRetry = isRetryable(err);
      const attempts = item.attempts + 1;
      const msg = userMessage(err) || err?.message || '업로드 중 오류 발생';
      const originalError = originalErrorDetails(err);
      const errorUpdates = {
        attempts,
        last_error: msg,
        last_error_code: originalError.code,
        last_error_detail: originalError.message,
        last_error_status: originalError.status ?? null,
      };

      if (isNeedReconnect) {
        this.isPaused = true;
        await updateItemStatus(item.id, 'paused', errorUpdates);
      } else if (isRetry && attempts < UPLOAD_LIMITS.maxAttempts) {
        const delay = backoffMs(attempts);
        await updateItemStatus(item.id, 'pending', errorUpdates);
        setTimeout(() => this.processQueue(), delay);
      } else {
        if (item.asset_id) {
          await failUpload(item.asset_id, originalError.code || 'UPLOAD_FAILED');
        }
        await updateItemStatus(item.id, 'failed', errorUpdates);
      }

      await this.notifyListeners(item.space_id);
    }
  }
}

export const queueManager = new QueueManager();
