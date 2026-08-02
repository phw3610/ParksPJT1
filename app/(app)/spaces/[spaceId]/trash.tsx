import { Image } from 'expo-image';
import { useLocalSearchParams } from 'expo-router';
import React, { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  FlatList,
  RefreshControl,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';

import { VideoBadge } from '@/components/VideoBadge';
import { colors, radius, spacing, typography } from '@/lib/theme';
import {
  listTrashedAssets,
  purgeAssets,
  restoreAssets,
  type TrashedAsset,
} from '@/storage/client';
import { createThumbnailSignedUrls } from '@/storage/thumbnails';

function formatDeletedAt(value: string): string {
  const deletedAt = new Date(value);
  return `${deletedAt.toLocaleDateString('ko-KR')} 삭제`;
}

export default function TrashScreen() {
  const { spaceId } = useLocalSearchParams<{ spaceId: string }>();

  const [items, setItems] = useState<TrashedAsset[]>([]);
  const [thumbnailUrls, setThumbnailUrls] = useState<Record<string, string>>({});
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [isLoading, setIsLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [isWorking, setIsWorking] = useState(false);

  const fetchTrash = useCallback(async () => {
    if (!spaceId) return;
    try {
      const { items: fetched } = await listTrashedAssets(spaceId);
      setItems(fetched);
      setSelectedIds(new Set());

      const urls = await createThumbnailSignedUrls(fetched);
      setThumbnailUrls(urls);
    } catch (error: any) {
      Alert.alert('휴지통을 열지 못했어요', error?.message || '잠시 후 다시 시도해 주세요.');
    }
  }, [spaceId]);

  useEffect(() => {
    let isCancelled = false;
    const load = async () => {
      setIsLoading(true);
      await fetchTrash();
      if (!isCancelled) setIsLoading(false);
    };
    void load();
    return () => {
      isCancelled = true;
    };
  }, [fetchTrash]);

  const onRefresh = async () => {
    setIsRefreshing(true);
    await fetchTrash();
    setIsRefreshing(false);
  };

  const toggleSelect = (item: TrashedAsset) => {
    if (!item.canRestore) {
      Alert.alert(
        '권한 없음',
        '이 항목은 올린 사람이나 관리자만 되돌리거나 지울 수 있어요.',
      );
      return;
    }
    const next = new Set(selectedIds);
    if (next.has(item.id)) next.delete(item.id);
    else next.add(item.id);
    setSelectedIds(next);
  };

  const handleRestore = async () => {
    const assetIds = Array.from(selectedIds);
    if (assetIds.length === 0 || isWorking) return;

    setIsWorking(true);
    try {
      const { restored, missing } = await restoreAssets(assetIds);
      await fetchTrash();

      if (missing.length > 0) {
        Alert.alert(
          '일부만 되돌렸어요',
          `${restored.length}개를 되돌렸고 ${missing.length}개는 Google Drive에서 이미 사라져 되돌릴 수 없었어요.`,
        );
      } else {
        Alert.alert('되돌리기 완료', `${restored.length}개를 앨범으로 되돌렸어요.`);
      }
    } catch (error: any) {
      Alert.alert('되돌리기 실패', error?.message || '되돌리지 못했습니다.');
    } finally {
      setIsWorking(false);
    }
  };

  const handlePurge = () => {
    const assetIds = Array.from(selectedIds);
    if (assetIds.length === 0 || isWorking) return;

    Alert.alert(
      '완전히 지우기',
      `${assetIds.length}개를 앨범에서 완전히 지울까요?\n\n※ Google 드라이브 휴지통에는 그대로 남아 있어요. 30일 안에는 드라이브에서 직접 되살릴 수 있습니다.`,
      [
        { text: '취소', style: 'cancel' },
        {
          text: '지우기',
          style: 'destructive',
          onPress: async () => {
            setIsWorking(true);
            try {
              const { purged } = await purgeAssets(assetIds);
              await fetchTrash();
              Alert.alert('삭제 완료', `${purged}개를 앨범에서 지웠어요.`);
            } catch (error: any) {
              Alert.alert('삭제 실패', error?.message || '지우지 못했습니다.');
            } finally {
              setIsWorking(false);
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

  return (
    <View style={styles.container}>
      <View style={styles.notice}>
        <Text style={typography.caption}>
          삭제한 사진과 영상이 여기에 남아요. 되돌리면 원래 폴더로 돌아갑니다.
        </Text>
      </View>

      <FlatList
        data={items}
        keyExtractor={(item) => item.id}
        numColumns={3}
        refreshControl={
          <RefreshControl
            refreshing={isRefreshing}
            onRefresh={onRefresh}
            tintColor={colors.primary}
          />
        }
        ListEmptyComponent={
          <View style={styles.empty}>
            <Text style={styles.emptyIcon}>🗑️</Text>
            <Text style={typography.heading}>휴지통이 비어 있어요</Text>
            <Text style={typography.caption}>삭제한 사진이 여기에 모입니다</Text>
          </View>
        }
        renderItem={({ item }) => {
          const isSelected = selectedIds.has(item.id);
          const thumbnailUrl = thumbnailUrls[item.id];
          return (
            <TouchableOpacity
              style={[styles.cell, isSelected && styles.cellSelected]}
              onPress={() => toggleSelect(item)}
              activeOpacity={0.8}
            >
              <View style={styles.cellInner}>
                {thumbnailUrl ? (
                  <Image
                    source={thumbnailUrl}
                    style={styles.thumbnail}
                    contentFit="cover"
                    cachePolicy="memory-disk"
                    recyclingKey={item.id}
                    transition={150}
                    accessibilityLabel={item.original_name}
                  />
                ) : (
                  <View style={styles.placeholderContent}>
                    <Text style={styles.placeholderIcon}>
                      {item.kind === 'video' ? '🎬' : '📷'}
                    </Text>
                    <Text style={styles.placeholderText}>미리보기 없음</Text>
                  </View>
                )}
                {item.kind === 'video' && <VideoBadge durationMs={item.duration_ms} />}
                {!item.canRestore && (
                  <View style={styles.lockBadge}>
                    <Text style={styles.lockBadgeText}>🔒</Text>
                  </View>
                )}
                {isSelected && (
                  <View style={styles.checkBadge}>
                    <Text style={styles.checkBadgeText}>✓</Text>
                  </View>
                )}
                <View style={styles.nameBackdrop}>
                  <Text style={styles.nameText} numberOfLines={1}>
                    {formatDeletedAt(item.deleted_at)}
                  </Text>
                </View>
              </View>
            </TouchableOpacity>
          );
        }}
      />

      {selectedIds.size > 0 && (
        <View style={styles.actionBar}>
          <Text style={styles.actionCount}>{selectedIds.size}개 선택</Text>
          <View style={styles.actionButtons}>
            <TouchableOpacity
              style={[styles.actionBtn, isWorking && styles.disabledBtn]}
              onPress={handleRestore}
              disabled={isWorking}
            >
              <Text style={styles.actionBtnText}>↩️ 되돌리기</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.actionBtn, styles.dangerBtn, isWorking && styles.disabledBtn]}
              onPress={handlePurge}
              disabled={isWorking}
            >
              <Text style={styles.dangerBtnText}>🗑️ 완전히 지우기</Text>
            </TouchableOpacity>
          </View>
        </View>
      )}
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
  notice: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    backgroundColor: colors.surface,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  empty: {
    paddingTop: spacing.xl * 2,
    alignItems: 'center',
    gap: spacing.xs,
  },
  emptyIcon: {
    fontSize: 48,
    marginBottom: spacing.sm,
  },
  cell: {
    width: '33.33%',
    aspectRatio: 1,
    padding: 2,
  },
  cellSelected: {
    opacity: 0.6,
  },
  cellInner: {
    flex: 1,
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: radius.sm,
    justifyContent: 'center',
    alignItems: 'center',
    overflow: 'hidden',
  },
  thumbnail: {
    ...StyleSheet.absoluteFillObject,
  },
  placeholderContent: {
    alignItems: 'center',
    gap: 4,
  },
  placeholderIcon: {
    fontSize: 24,
  },
  placeholderText: {
    color: colors.textMuted,
    fontSize: 10,
    fontWeight: '600',
  },
  lockBadge: {
    position: 'absolute',
    top: 4,
    left: 4,
    paddingHorizontal: 4,
    paddingVertical: 2,
    borderRadius: radius.sm,
    backgroundColor: 'rgba(0, 0, 0, 0.65)',
  },
  lockBadgeText: {
    fontSize: 10,
  },
  checkBadge: {
    position: 'absolute',
    top: 6,
    right: 6,
    backgroundColor: colors.primary,
    width: 20,
    height: 20,
    borderRadius: radius.full,
    justifyContent: 'center',
    alignItems: 'center',
  },
  checkBadgeText: {
    color: colors.primaryText,
    fontSize: 12,
    fontWeight: '700',
  },
  nameBackdrop: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    paddingHorizontal: 4,
    paddingVertical: 3,
    backgroundColor: 'rgba(0, 0, 0, 0.55)',
  },
  nameText: {
    color: '#FFFFFF',
    fontSize: 10,
    textAlign: 'center',
  },
  actionBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.sm,
    padding: spacing.md,
    backgroundColor: colors.surface,
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
  actionCount: {
    color: colors.text,
    fontSize: 14,
    fontWeight: '600',
  },
  actionButtons: {
    flexDirection: 'row',
    gap: spacing.sm,
  },
  actionBtn: {
    backgroundColor: colors.surfaceAlt,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: radius.sm,
  },
  actionBtnText: {
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
