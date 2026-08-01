import type { Asset } from '@/lib/database.types';
import { supabase } from '@/lib/supabase';

export const THUMBNAIL_URL_TTL_SECONDS = 60 * 60;
export const THUMBNAIL_URL_REFRESH_MS = 55 * 60 * 1000;

type ThumbnailAsset = Pick<Asset, 'id' | 'thumb_path'>;

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
