import { Image } from 'expo-image';
import { useLocalSearchParams, useRouter } from 'expo-router';
import React, { useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Platform,
  StyleSheet,
  Text,
  TouchableOpacity,
  useWindowDimensions,
  View,
  ViewToken,
} from 'react-native';

import { FolderPickerModal } from '@/components/FolderPickerModal';
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

const PAGE_SIZE = 36;

export default function AssetDetailScreen() {
  const { spaceId, assetId, source } = useLocalSearchParams<{
    spaceId: string;
    assetId: string;
    source?: string;
  }>();
  const router = useRouter();
  const { width: screenWidth } = useWindowDimensions();

  const isTimelineScope = source === 'timeline';

  const [assetsList, setAssetsList] = useState<Asset[]>([]);
  const [currentIndex, setCurrentIndex] = useState<number>(0);
  const [thumbnailUrls, setThumbnailUrls] = useState<Record<string, string>>({});
  const [isLoading, setIsLoading] = useState(true);
  const [isDownloading, setIsDownloading] = useState(false);
  const [showFolderPicker, setShowFolderPicker] = useState(false);
  const [isMoving, setIsMoving] = useState(false);
  const [hasMore, setHasMore] = useState(true);
  const [isFetchingMore, setIsFetchingMore] = useState(false);

  const flatListRef = useRef<FlatList<Asset>>(null);
  const assetsListRef = useRef<Asset[]>([]);
  assetsListRef.current = assetsList;

  // 1. assetId나 spaceId 변경 시 사진 목록 조회
  useEffect(() => {
    if (!assetId || !spaceId) return;

    // 현재 보유한 assetsList에 해당 assetId가 이미 있으면 중복 조회하지 않고 인덱스만 갱신
    const existingIndex = assetsList.findIndex((a) => a.id === assetId);
    if (existingIndex !== -1) {
      if (existingIndex !== currentIndex) {
        setCurrentIndex(existingIndex);
      }
      return;
    }

    let isCancelled = false;

    const loadAssetsData = async () => {
      setIsLoading(true);
      try {
        // 단일 asset 정보 우선 조회
        const { data: rawTargetAsset, error: targetError } = await supabase
          .from('assets')
          .select('*')
          .eq('id', assetId)
          .single();

        const targetAsset = rawTargetAsset as Asset | null;

        if (targetError || !targetAsset) {
          if (!isCancelled) {
            setAssetsList([]);
            setCurrentIndex(0);
          }
          return;
        }

        // 범위에 맞게 사진 목록 조회
        // - 타임라인 범위(source=timeline): 스페이스 전체 사진 (folder_id 필터 없음)
        // - 폴더 범위(기본값): targetAsset.folder_id와 동일한 폴더 내 사진
        let query = supabase
          .from('assets')
          .select('*')
          .eq('space_id', spaceId)
          .is('deleted_at', null);

        if (!isTimelineScope) {
          const folderId = targetAsset.folder_id;
          if (folderId) {
            query = query.eq('folder_id', folderId);
          } else {
            query = query.is('folder_id', null);
          }
        }

        // 타임라인 범위는 사진 수량이 많을 수 있으므로 PAGE_SIZE 단위로 1페이지 제한
        if (isTimelineScope) {
          query = query.range(0, PAGE_SIZE - 1);
        }

        const { data: rawList, error: listError } = await query
          .order('captured_at', { ascending: false, nullsFirst: false })
          .order('created_at', { ascending: false });

        const list = (rawList as Asset[] | null) ?? [];

        if (isCancelled) return;

        if (listError || list.length === 0) {
          setAssetsList([targetAsset]);
          setCurrentIndex(0);
          setHasMore(false);
        } else {
          const idx = list.findIndex((a) => a.id === assetId);
          if (idx !== -1) {
            setAssetsList(list);
            setCurrentIndex(idx);
            setHasMore(isTimelineScope ? list.length >= PAGE_SIZE : false);
          } else {
            // 타임라인 1페이지에 진입 asset이 포함되지 않은 경우(더 아래 위치), 진입 asset을 맨 앞에 포함
            setAssetsList([targetAsset, ...list]);
            setCurrentIndex(0);
            setHasMore(isTimelineScope ? list.length >= PAGE_SIZE : false);
          }
        }
      } catch {
        if (!isCancelled) {
          setAssetsList([]);
          setCurrentIndex(0);
        }
      } finally {
        if (!isCancelled) {
          setIsLoading(false);
        }
      }
    };

    void loadAssetsData();

    return () => {
      isCancelled = true;
    };
  }, [assetId, spaceId, isTimelineScope]);

  // 2. 타임라인 범위 스와이프 시 다음 페이지 사진 추가 조회 (onEndReached)
  const fetchMoreAssets = async () => {
    if (!isTimelineScope || isFetchingMore || !hasMore || isLoading || !spaceId) return;

    setIsFetchingMore(true);
    try {
      const currentLoaded = assetsListRef.current;
      const from = currentLoaded.length;
      const to = from + PAGE_SIZE - 1;

      const { data: rawList, error } = await supabase
        .from('assets')
        .select('*')
        .eq('space_id', spaceId)
        .is('deleted_at', null)
        .order('captured_at', { ascending: false, nullsFirst: false })
        .order('created_at', { ascending: false })
        .range(from, to);

      if (error) throw error;

      const newFetched = (rawList as Asset[] | null) || [];
      if (newFetched.length < PAGE_SIZE) {
        setHasMore(false);
      }

      const existingIds = new Set(currentLoaded.map((a) => a.id));
      const uniqueNewAssets = newFetched.filter((a) => !existingIds.has(a.id));

      if (uniqueNewAssets.length > 0) {
        const combined = [...currentLoaded, ...uniqueNewAssets];
        setAssetsList(combined);

        // 새로 추가된 사진에 대해서만 썸네일 서명 URL 추가 발급
        const newUrls = await createThumbnailSignedUrls(uniqueNewAssets);
        setThumbnailUrls((prev) => ({ ...prev, ...newUrls }));
      }
    } catch {
      /* 무시 */
    } finally {
      setIsFetchingMore(false);
    }
  };

  // 3. assetsList 목록 전체에 대해 썸네일 서명 URL 일괄 발급 및 주기적 갱신
  useEffect(() => {
    if (assetsList.length === 0) {
      setThumbnailUrls({});
      return;
    }

    let isCancelled = false;
    const refreshThumbnailUrls = async () => {
      try {
        const urls = await createThumbnailSignedUrls(assetsListRef.current);
        if (!isCancelled) {
          setThumbnailUrls(urls);
        }
      } catch {
        if (!isCancelled) {
          setThumbnailUrls({});
        }
      }
    };

    void refreshThumbnailUrls();
    const refreshTimer = setInterval(() => {
      void refreshThumbnailUrls();
    }, THUMBNAIL_URL_REFRESH_MS);

    return () => {
      isCancelled = true;
      clearInterval(refreshTimer);
    };
  }, [assetsList.length]);

  // 4. currentIndex 변경 시 URL의 assetId 동기화
  useEffect(() => {
    const currentAsset = assetsList[currentIndex];
    if (currentAsset && currentAsset.id !== assetId) {
      router.setParams({
        assetId: currentAsset.id,
        ...(source ? { source } : {}),
      });
    }
  }, [currentIndex, assetsList, assetId, router, source]);

  const currentAsset = assetsList[currentIndex] ?? null;

  // 5. 스와이프 시 현재 감지된 아이템 변경 처리
  const onViewableItemsChanged = useRef(
    ({ viewableItems }: { viewableItems: ViewToken[] }) => {
      if (
        viewableItems.length > 0 &&
        viewableItems[0].index !== null &&
        viewableItems[0].index !== undefined
      ) {
        setCurrentIndex(viewableItems[0].index);
      }
    }
  ).current;

  const viewabilityConfig = useRef({
    itemVisiblePercentThreshold: 50,
  }).current;

  const handleDownload = async () => {
    if (!currentAsset) return;
    setIsDownloading(true);

    try {
      await downloadSingleAssetToCameraRoll(currentAsset.id, currentAsset.original_name);
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

  const handleMove = async (targetFolderId: string | null, targetFolderName: string) => {
    if (!currentAsset || !spaceId || isMoving) return;

    if (targetFolderId === currentAsset.folder_id) {
      setShowFolderPicker(false);
      Alert.alert('알림', '이미 선택한 폴더에 있는 사진입니다.');
      return;
    }

    setIsMoving(true);
    try {
      const targetId = currentAsset.id;
      const { data, error } = await (supabase.from('assets') as any)
        .update({ folder_id: targetFolderId })
        .eq('space_id', spaceId)
        .eq('id', targetId)
        .select('id');

      if (error) throw error;

      setShowFolderPicker(false);

      if (((data || []) as Array<{ id: string }>).length === 0) {
        Alert.alert(
          '이동할 수 없음',
          '이 사진을 옮기지 못했습니다. 멤버는 자신이 올린 사진만 옮길 수 있어요.',
        );
        return;
      }

      if (isTimelineScope) {
        // 타임라인 범위: 폴더 경계를 보지 않는 스페이스 전체 뷰이므로 다른 폴더로 옮겨도 목록에서 빠지지 않고 folder_id만 갱신
        const updatedList = assetsList.map((a) =>
          a.id === targetId ? { ...a, folder_id: targetFolderId } : a
        );
        setAssetsList(updatedList);
        Alert.alert('이동 완료', `사진을 '${targetFolderName}'으로 옮겼어요.`);
      } else {
        // 폴더 범위: 옮긴 사진은 이 폴더 목록에서 빠지므로 삭제와 같은 방식으로 이웃 사진을 이어 보여준다.
        const nextList = assetsList.filter((a) => a.id !== targetId);
        if (nextList.length === 0) {
          Alert.alert(
            '이동 완료',
            `사진을 '${targetFolderName}'으로 옮겼어요.\n이 폴더에 남은 사진이 없어 이전 화면으로 돌아갑니다.`,
            [{ text: '확인', onPress: () => router.back() }],
          );
          return;
        }

        const nextIndex = Math.min(currentIndex, nextList.length - 1);
        setAssetsList(nextList);
        setCurrentIndex(nextIndex);
        router.setParams({ assetId: nextList[nextIndex].id, ...(source ? { source } : {}) });
        Alert.alert('이동 완료', `사진을 '${targetFolderName}'으로 옮겼어요.`);
      }
    } catch (e: any) {
      Alert.alert('이동 실패', e?.message || '사진을 옮기지 못했습니다.');
    } finally {
      setIsMoving(false);
    }
  };

  const handleDelete = async () => {
    if (!currentAsset || !spaceId) return;

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
              const targetId = currentAsset.id;
              await deleteAssets([targetId], true);

              const nextList = assetsList.filter((a) => a.id !== targetId);
              if (nextList.length === 0) {
                Alert.alert(
                  '삭제 완료',
                  '사진을 Google Drive 휴지통으로 옮겼어요.\n모든 사진이 삭제되어 이전 화면으로 돌아갑니다.',
                  [{ text: '확인', onPress: () => router.back() }]
                );
              } else {
                const nextIndex = Math.min(currentIndex, nextList.length - 1);
                setAssetsList(nextList);
                setCurrentIndex(nextIndex);
                router.setParams({ assetId: nextList[nextIndex].id, ...(source ? { source } : {}) });
                Alert.alert(
                  '삭제 완료',
                  '사진을 Google Drive 휴지통으로 옮겼어요.'
                );
              }
            } catch (e: any) {
              Alert.alert('삭제 실패', e.message);
            }
          },
        },
      ]
    );
  };

  if (isLoading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator size="large" color={colors.primary} />
      </View>
    );
  }

  if (!currentAsset || assetsList.length === 0) {
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
        <Text style={styles.fileName}>{currentAsset.original_name}</Text>
        <Text style={typography.caption}>
          촬영일:{' '}
          {currentAsset.captured_at
            ? new Date(currentAsset.captured_at).toLocaleDateString('ko-KR')
            : new Date(currentAsset.created_at).toLocaleDateString('ko-KR')}
          {assetsList.length > 1 ? ` (${currentIndex + 1} / ${assetsList.length})` : ''}
          {isTimelineScope ? ' [타임라인]' : ''}
        </Text>
      </View>

      {/* 2. Photo Display Area (Horizontal FlatList for Swiping) */}
      <FlatList
        ref={flatListRef}
        data={assetsList}
        horizontal
        pagingEnabled
        showsHorizontalScrollIndicator={false}
        initialScrollIndex={currentIndex}
        getItemLayout={(_, index) => ({
          length: screenWidth,
          offset: screenWidth * index,
          index,
        })}
        onViewableItemsChanged={onViewableItemsChanged}
        viewabilityConfig={viewabilityConfig}
        onEndReached={isTimelineScope ? fetchMoreAssets : undefined}
        onEndReachedThreshold={0.5}
        keyExtractor={(item) => item.id}
        windowSize={3}
        maxToRenderPerBatch={3}
        initialNumToRender={3}
        removeClippedSubviews={Platform.OS === 'android'}
        renderItem={({ item }) => {
          const thumbUrl = thumbnailUrls[item.id];
          return (
            <View style={[styles.imageBox, { width: screenWidth }]}>
              {thumbUrl ? (
                <Image
                  source={thumbUrl}
                  style={styles.previewImage}
                  contentFit="contain"
                  cachePolicy="memory-disk"
                  transition={150}
                  accessibilityLabel={item.original_name}
                />
              ) : (
                <Text style={styles.imageIcon}>📷</Text>
              )}
              <View style={styles.imageMetadata}>
                <Text style={styles.imageText}>
                  원본 해상도: {item.width || '?'} x {item.height || '?'}
                </Text>
                <Text style={typography.caption}>
                  파일 크기: {(item.byte_size / (1024 * 1024)).toFixed(2)} MB
                </Text>
              </View>
            </View>
          );
        }}
      />

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

        <TouchableOpacity
          style={[styles.toolBtn, isMoving && styles.disabledBtn]}
          onPress={() => setShowFolderPicker(true)}
          disabled={isMoving}
        >
          <Text style={styles.toolBtnText}>{isMoving ? '이동 중...' : '📁 이동'}</Text>
        </TouchableOpacity>

        <TouchableOpacity style={[styles.toolBtn, styles.dangerBtn]} onPress={handleDelete}>
          <Text style={styles.dangerBtnText}>🗑️ 삭제</Text>
        </TouchableOpacity>
      </View>

      <FolderPickerModal
        visible={showFolderPicker}
        spaceId={spaceId}
        currentFolderId={currentAsset.folder_id}
        busy={isMoving}
        onClose={() => setShowFolderPicker(false)}
        onSelect={(targetFolderId, targetFolderName) => {
          void handleMove(targetFolderId, targetFolderName);
        }}
      />
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
