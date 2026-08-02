import { EncodingType, readAsStringAsync } from 'expo-file-system/legacy';

import type { Asset } from '@/lib/database.types';
import { supabase } from '@/lib/supabase';

export const THUMBNAIL_URL_TTL_SECONDS = 60 * 60;
export const THUMBNAIL_URL_REFRESH_MS = 55 * 60 * 1000;

type ThumbnailAsset = Pick<Asset, 'id' | 'thumb_path'>;

/**
 * React Native의 Blob 대신 Supabase Storage가 지원하는 ArrayBuffer를 만든다.
 * 현재 Phase 1에서는 별도 리사이즈 없이 원본 파일 바이트를 썸네일로 사용한다.
 */
export async function readThumbnailUploadBody(fileUri: string): Promise<ArrayBuffer> {
  const base64 = await readAsStringAsync(fileUri, { encoding: EncodingType.Base64 });
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);

  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }

  return bytes.buffer;
}

/** private thumbs 버킷의 URL을 한 번의 요청으로 발급한다. */
export async function createThumbnailSignedUrls(
  assets: ThumbnailAsset[],
): Promise<Record<string, string>> {
  const assetsWithThumbs = assets.filter(
    (asset): asset is ThumbnailAsset & { thumb_path: string } => Boolean(asset.thumb_path),
  );

  if (assetsWithThumbs.length === 0) return {};

  const paths = [...new Set(assetsWithThumbs.map((asset) => asset.thumb_path))];
  const { data, error } = await supabase.storage
    .from('thumbs')
    .createSignedUrls(paths, THUMBNAIL_URL_TTL_SECONDS);

  if (error) throw error;

  const signedUrlByPath = new Map<string, string>();
  for (const result of data) {
    if (result.path && result.signedUrl && !result.error) {
      signedUrlByPath.set(result.path, result.signedUrl);
    }
  }

  return Object.fromEntries(
    assetsWithThumbs.flatMap((asset) => {
      const signedUrl = signedUrlByPath.get(asset.thumb_path);
      return signedUrl ? [[asset.id, signedUrl]] : [];
    }),
  );
}
