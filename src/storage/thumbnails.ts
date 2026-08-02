import { File } from 'expo-file-system';
import { ImageManipulator, SaveFormat } from 'expo-image-manipulator';

import type { Asset } from '@/lib/database.types';
import { supabase } from '@/lib/supabase';

export const THUMBNAIL_URL_TTL_SECONDS = 60 * 60;
export const THUMBNAIL_URL_REFRESH_MS = 55 * 60 * 1000;
// 16:9 사진도 짧은 변 1440px를 남겨 QHD급 상세 화면을 채울 수 있다.
export const THUMBNAIL_MAX_LONG_EDGE_PX = 2560;
// 전체 화면에서 JPEG 아티팩트를 억제하면서 원본 대비 전송량을 크게 줄이는 균형값이다.
export const THUMBNAIL_JPEG_QUALITY = 0.8;

type ThumbnailAsset = Pick<Asset, 'id' | 'thumb_path'>;

/**
 * 상세 화면에서도 쓰이는 미리보기를 긴 변 2560px 이하의 JPEG로 만든다.
 * ImageManipulator가 먼저 표시 방향을 픽셀에 반영하며, File.bytes()로 base64 복제를 피한다.
 */
export async function readThumbnailUploadBody(fileUri: string): Promise<ArrayBuffer> {
  const context = ImageManipulator.manipulate(fileUri);
  const orientedImage = await context.renderAsync();
  let renderedImage = orientedImage;

  if (Math.max(orientedImage.width, orientedImage.height) > THUMBNAIL_MAX_LONG_EDGE_PX) {
    if (orientedImage.width >= orientedImage.height) {
      context.resize({ width: THUMBNAIL_MAX_LONG_EDGE_PX, height: null });
    } else {
      context.resize({ width: null, height: THUMBNAIL_MAX_LONG_EDGE_PX });
    }
    renderedImage = await context.renderAsync();
  }

  let temporaryFile: File | null = null;

  try {
    const result = await renderedImage.saveAsync({
      compress: THUMBNAIL_JPEG_QUALITY,
      format: SaveFormat.JPEG,
    });
    temporaryFile = new File(result.uri);
    const bytes = await temporaryFile.bytes();

    return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
  } finally {
    if (temporaryFile?.exists) {
      temporaryFile.delete();
    }
  }
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
