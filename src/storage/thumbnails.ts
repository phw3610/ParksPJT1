import { File } from 'expo-file-system';
import { ImageManipulator, SaveFormat } from 'expo-image-manipulator';
import * as VideoThumbnails from 'expo-video-thumbnails';

import type { Asset } from '@/lib/database.types';
import { supabase } from '@/lib/supabase';

export const THUMBNAIL_URL_TTL_SECONDS = 60 * 60;
export const THUMBNAIL_URL_REFRESH_MS = 55 * 60 * 1000;
// 3열 그리드의 약 130pt 셀은 @3x iPhone에서 약 390px이므로 400px이면 충분하다.
export const THUMBNAIL_MAX_LONG_EDGE_PX = 400;
// 작은 그리드 셀에서 품질을 유지하면서 일반 사진을 대략 수십 KB로 줄이는 균형값이다.
export const THUMBNAIL_JPEG_QUALITY = 0.75;
// 첫 프레임은 검은 화면인 경우가 많아 1초 지점을 쓴다.
const VIDEO_THUMBNAIL_TIME_MS = 1000;

type ThumbnailAsset = Pick<Asset, 'id' | 'thumb_path'>;

/**
 * 3열 그리드에서 쓰이는 미리보기를 긴 변 400px 이하의 JPEG로 만든다.
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

/**
 * 영상은 한 프레임을 뽑아 사진과 같은 규격의 JPEG 썸네일로 만든다.
 * 그래야 그리드에서 사진과 영상이 같은 방식으로 표시된다.
 */
export async function readVideoThumbnailUploadBody(fileUri: string): Promise<ArrayBuffer> {
  let frameUri: string;
  try {
    ({ uri: frameUri } = await VideoThumbnails.getThumbnailAsync(fileUri, {
      time: VIDEO_THUMBNAIL_TIME_MS,
    }));
  } catch {
    // 1초보다 짧은 영상은 그 지점이 없어 실패하므로 첫 프레임으로 되돌린다.
    ({ uri: frameUri } = await VideoThumbnails.getThumbnailAsync(fileUri, { time: 0 }));
  }

  try {
    return await readThumbnailUploadBody(frameUri);
  } finally {
    const frameFile = new File(frameUri);
    if (frameFile.exists) {
      frameFile.delete();
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
