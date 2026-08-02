import { Image } from 'expo-image';
import { useLocalSearchParams, useRouter } from 'expo-router';
import React, { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';

import type { Asset } from '@/lib/database.types';
import { supabase } from '@/lib/supabase';
import { colors, radius, spacing, typography } from '@/lib/theme';
import { deleteAssets } from '@/storage/client';
import {
  CameraRollDownloadError,
  downloadSingleAssetToCameraRoll,
} from '@/storage/downloadToCameraRoll';
import {
  createThumbnailSignedUrls,
  THUMBNAIL_URL_REFRESH_MS,
} from '@/storage/thumbnails';

export default function AssetDetailScreen() {
  const { spaceId, assetId } = useLocalSearchParams<{ spaceId: string; assetId: string }>();
  const router = useRouter();

  const [asset, setAsset] = useState<Asset | null>(null);
  const [thumbnailUrl, setThumbnailUrl] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isDownloading, setIsDownloading] = useState(false);

  useEffect(() => {
    if (!assetId) return;
    const fetchAsset = async () => {
      try {
        const { data, error } = await supabase
          .from('assets')
          .select('*')
          .eq('id', assetId)
          .single();

        if (error) throw error;
        setAsset(data);
      } catch {
        /* 에러 무시 */
      } finally {
        setIsLoading(false);
      }
    };

    fetchAsset();
  }, [assetId]);

  useEffect(() => {
    if (!asset?.thumb_path) {
      setThumbnailUrl(null);
      return;
    }

    let isCancelled = false;
    const refreshThumbnailUrl = async () => {
      try {
        const urls = await createThumbnailSignedUrls([asset]);
        if (!isCancelled) setThumbnailUrl(urls[asset.id] ?? null);
      } catch {
        if (!isCancelled) setThumbnailUrl(null);
      }
    };

    void refreshThumbnailUrl();
    const refreshTimer = setInterval(() => {
      void refreshThumbnailUrl();
    }, THUMBNAIL_URL_REFRESH_MS);

    return () => {
      isCancelled = true;
      clearInterval(refreshTimer);
    };
  }, [asset]);

  const handleDownload = async () => {
    if (!assetId || !asset) return;
    setIsDownloading(true);

    try {
      await downloadSingleAssetToCameraRoll(assetId, asset.original_name);
      Alert.alert('다운로드 완료', '카메라롤에 사진을 저장했습니다.');
    } catch (e: any) {
      if (e instanceof CameraRollDownloadError) {
        let title = '다운로드 실패';
        if (e.code === 'PERMISSION_DENIED') {
          title = '권한 거부';
        } else if (e.code === 'TICKET_FAILED') {
          title = '티켓 발급 실패';
        } else if (e.code === 'DOWNLOAD_FAILED') {
          title = '다운로드 실패';
        } else if (e.code === 'SAVE_FAILED') {
          title = '저장 실패';
        }
        Alert.alert(title, e.message);
      } else {
        Alert.alert('다운로드 실패', e?.message || '사진을 다운로드하지 못했습니다.');
      }
    } finally {
      setIsDownloading(false);
    }
  };

  const handleDelete = async () => {
    if (!assetId || !spaceId) return;

    Alert.alert(
      '사진 삭제',
      '이 사진을 Google Drive 휴지통으로 옮길까요?\n앱 목록에서는 사라지며, 복구하려면 Google Drive에서 해야 합니다.',
      [
        { text: '취소', style: 'cancel' },
        {
          text: '삭제',
          style: 'destructive',
          onPress: async () => {
            try {
              await deleteAssets([assetId], true);
              Alert.alert(
                '삭제 완료',
                '사진을 Google Drive 휴지통으로 옮겼어요.\n앱 목록에서는 사라졌으며, 복구하려면 Google Drive에서 복원해 주세요.',
                [{ text: '확인', onPress: () => router.back() }],
              );
            } catch (e: any) {
              Alert.alert('삭제 실패', e.message);
            }
          },
        },
      ],
    );
  };

  if (isLoading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator size="large" color={colors.primary} />
      </View>
    );
  }

  if (!asset) {
    return (
      <View style={styles.center}>
        <Text style={typography.heading}>사진을 찾을 수 없습니다.</Text>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      {/* 1. Header Metadata */}
      <View style={styles.header}>
        <Text style={styles.fileName}>{asset.original_name}</Text>
        <Text style={typography.caption}>
          촬영일:{' '}
          {asset.captured_at
            ? new Date(asset.captured_at).toLocaleDateString('ko-KR')
            : new Date(asset.created_at).toLocaleDateString('ko-KR')}
        </Text>
      </View>

      {/* 2. Photo Display Area */}
      <View style={styles.imageBox}>
        {thumbnailUrl ? (
          <Image
            source={thumbnailUrl}
            style={styles.previewImage}
            contentFit="contain"
            cachePolicy="memory-disk"
            transition={150}
            accessibilityLabel={asset.original_name}
            onError={() => setThumbnailUrl(null)}
          />
        ) : (
          <Text style={styles.imageIcon}>📷</Text>
        )}
        <View style={styles.imageMetadata}>
          <Text style={styles.imageText}>원본 해상도: {asset.width || '?'} x {asset.height || '?'}</Text>
          <Text style={typography.caption}>파일 크기: {(asset.byte_size / (1024 * 1024)).toFixed(2)} MB</Text>
        </View>
      </View>

      {/* 3. Bottom Toolbar */}
      <View style={styles.toolbar}>
        <TouchableOpacity
          style={[styles.toolBtn, isDownloading && styles.disabledBtn]}
          onPress={handleDownload}
          disabled={isDownloading}
        >
          <Text style={styles.toolBtnText}>
            {isDownloading ? '다운로드 중...' : '📥 다운로드'}
          </Text>
        </TouchableOpacity>

        <TouchableOpacity style={styles.toolBtn} onPress={() => Alert.alert('폴더 이동', '이동할 폴더를 선택하세요.')}>
          <Text style={styles.toolBtnText}>📁 이동</Text>
        </TouchableOpacity>

        <TouchableOpacity style={[styles.toolBtn, styles.dangerBtn]} onPress={handleDelete}>
          <Text style={styles.dangerBtnText}>🗑️ 삭제</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.bg,
  },
  center: {
    flex: 1,
    backgroundColor: colors.bg,
    justifyContent: 'center',
    alignItems: 'center',
  },
  header: {
    padding: spacing.md,
    backgroundColor: colors.surface,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  fileName: {
    color: colors.text,
    fontSize: 16,
    fontWeight: '700',
    marginBottom: 4,
  },
  imageBox: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#000000',
  },
  previewImage: {
    ...StyleSheet.absoluteFillObject,
  },
  imageIcon: {
    fontSize: 64,
  },
  imageMetadata: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    padding: spacing.md,
    backgroundColor: 'rgba(0, 0, 0, 0.6)',
  },
  imageText: {
    color: colors.text,
    fontSize: 14,
    marginBottom: spacing.xs,
  },
  toolbar: {
    flexDirection: 'row',
    justifyContent: 'space-around',
    backgroundColor: colors.surface,
    padding: spacing.md,
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
  toolBtn: {
    backgroundColor: colors.surfaceAlt,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: radius.sm,
  },
  toolBtnText: {
    color: colors.text,
    fontSize: 14,
    fontWeight: '600',
  },
  dangerBtn: {
    backgroundColor: 'rgba(248, 113, 113, 0.2)',
  },
  dangerBtnText: {
    color: colors.danger,
    fontSize: 14,
    fontWeight: '600',
  },
  disabledBtn: {
    opacity: 0.6,
  },
});
