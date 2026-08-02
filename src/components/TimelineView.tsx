import { Image } from 'expo-image';
import { useRouter } from 'expo-router';
import React, { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  RefreshControl,
  SectionList,
  StyleSheet,
  Text,
  TouchableOpacity,
  useWindowDimensions,
  View,
} from 'react-native';

import type { Asset } from '@/lib/database.types';
import { supabase } from '@/lib/supabase';
import { colors, radius, spacing, typography } from '@/lib/theme';
import {
  createThumbnailSignedUrls,
  THUMBNAIL_URL_REFRESH_MS,
} from '@/storage/thumbnails';

export interface TimelineViewProps {
  spaceId: string;
}

interface TimelineSection {
  title: string;
  data: Asset[][];
}

function formatDateGroupTitle(dateString: string): string {
  const d = new Date(dateString);
  if (isNaN(d.getTime())) return '날짜 알 수 없음';
  const year = d.getFullYear();
  const month = d.getMonth() + 1;
  const day = d.getDate();
  const dayNames = ['일', '월', '화', '수', '목', '금', '토'];
  const dayOfWeek = dayNames[d.getDay()];
  return `${year}년 ${month}월 ${day}일 (${dayOfWeek})`;
}

function groupAssetsByDate(assets: Asset[]): TimelineSection[] {
  const groups = new Map<string, { title: string; assets: Asset[] }>();

  for (const asset of assets) {
    const rawDate = asset.captured_at || asset.created_at;
    const dateObj = new Date(rawDate);
    const dateKey = isNaN(dateObj.getTime())
      ? 'unknown'
      : `${dateObj.getFullYear()}-${String(dateObj.getMonth() + 1).padStart(2, '0')}-${String(dateObj.getDate()).padStart(2, '0')}`;

    const title = isNaN(dateObj.getTime())
      ? '날짜 알 수 없음'
      : formatDateGroupTitle(rawDate);

    if (!groups.has(dateKey)) {
      groups.set(dateKey, { title, assets: [] });
    }
    groups.get(dateKey)!.assets.push(asset);
  }

  const sections: TimelineSection[] = [];
  for (const group of groups.values()) {
    const rows: Asset[][] = [];
    for (let i = 0; i < group.assets.length; i += 3) {
      rows.push(group.assets.slice(i, i + 3));
    }
    sections.push({
      title: group.title,
      data: rows,
    });
  }

  return sections;
}

export function TimelineView({ spaceId }: TimelineViewProps) {
  const router = useRouter();
  const { width } = useWindowDimensions();

  const [assets, setAssets] = useState<Asset[]>([]);
  const [sections, setSections] = useState<TimelineSection[]>([]);
  const [thumbnailUrls, setThumbnailUrls] = useState<Record<string, string>>({});
  const [isLoading, setIsLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);

  // 3열 그리드 항목 크기 계산
  const numColumns = 3;
  const gap = spacing.xs;
  const padding = spacing.md;
  const itemSize = Math.floor((width - padding * 2 - gap * (numColumns - 1)) / numColumns);

  const fetchTimelineAssets = useCallback(async () => {
    if (!spaceId) return;
    try {
      // 정렬 계약: captured_at DESC nullsLast, created_at DESC (폴더 무관 전체 스페이스)
      const { data, error } = await supabase
        .from('assets')
        .select('*')
        .eq('space_id', spaceId)
        .is('deleted_at', null)
        .order('captured_at', { ascending: false, nullsFirst: false })
        .order('created_at', { ascending: false });

      if (error) throw error;

      const loadedAssets = (data as Asset[] | null) || [];
      setAssets(loadedAssets);
      setSections(groupAssetsByDate(loadedAssets));
    } catch {
      setAssets([]);
      setSections([]);
    } finally {
      setIsLoading(false);
      setIsRefreshing(false);
    }
  }, [spaceId]);

  useEffect(() => {
    void fetchTimelineAssets();
  }, [fetchTimelineAssets]);

  // 썸네일 서명 URL 배열 일괄 발급 및 주기적 갱신
  useEffect(() => {
    if (assets.length === 0) {
      setThumbnailUrls({});
      return;
    }

    let isCancelled = false;
    const refreshThumbnailUrls = async () => {
      try {
        const urls = await createThumbnailSignedUrls(assets);
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
  }, [assets]);

  const handleRefresh = () => {
    setIsRefreshing(true);
    void fetchTimelineAssets();
  };

  if (isLoading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator size="large" color={colors.primary} />
      </View>
    );
  }

  if (assets.length === 0) {
    return (
      <View style={styles.center}>
        <Text style={styles.emptyIcon}>📅</Text>
        <Text style={typography.heading}>업로드된 사진이 없습니다.</Text>
        <Text style={[typography.caption, styles.emptySub]}>
          사진을 올려 타임라인을 채워보세요.
        </Text>
      </View>
    );
  }

  return (
    <SectionList
      sections={sections}
      keyExtractor={(row, index) => (row[0] ? row[0].id : `row-${index}`)}
      stickySectionHeadersEnabled
      contentContainerStyle={styles.listContent}
      refreshControl={
        <RefreshControl
          refreshing={isRefreshing}
          onRefresh={handleRefresh}
          tintColor={colors.primary}
        />
      }
      renderSectionHeader={({ section: { title } }) => (
        <View style={styles.sectionHeader}>
          <Text style={styles.sectionTitle}>{title}</Text>
        </View>
      )}
      renderItem={({ item: row }) => (
        <View style={styles.row}>
          {row.map((asset) => {
            const thumbUrl = thumbnailUrls[asset.id];
            return (
              <TouchableOpacity
                key={asset.id}
                style={[styles.photoThumb, { width: itemSize, height: itemSize }]}
                activeOpacity={0.8}
                onPress={() =>
                  router.push(`/(app)/spaces/${spaceId}/asset/${asset.id}`)
                }
              >
                {thumbUrl ? (
                  <Image
                    source={thumbUrl}
                    style={styles.thumbImage}
                    contentFit="cover"
                    cachePolicy="memory-disk"
                    transition={150}
                    accessibilityLabel={asset.original_name}
                  />
                ) : (
                  <View style={styles.thumbPlaceholder}>
                    <Text style={styles.thumbIcon}>📷</Text>
                  </View>
                )}
              </TouchableOpacity>
            );
          })}
        </View>
      )}
    />
  );
}

const styles = StyleSheet.create({
  center: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: colors.bg,
    padding: spacing.xl,
  },
  emptyIcon: {
    fontSize: 48,
    marginBottom: spacing.sm,
  },
  emptySub: {
    marginTop: spacing.xs,
    textAlign: 'center',
  },
  listContent: {
    paddingHorizontal: spacing.md,
    paddingBottom: spacing.xl,
  },
  sectionHeader: {
    backgroundColor: colors.bg,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.xs,
    marginTop: spacing.sm,
  },
  sectionTitle: {
    color: colors.text,
    fontSize: 14,
    fontWeight: '700',
  },
  row: {
    flexDirection: 'row',
    gap: spacing.xs,
    marginBottom: spacing.xs,
  },
  photoThumb: {
    borderRadius: radius.sm,
    overflow: 'hidden',
    backgroundColor: colors.surfaceAlt,
  },
  thumbImage: {
    ...StyleSheet.absoluteFillObject,
  },
  thumbPlaceholder: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: colors.surfaceAlt,
  },
  thumbIcon: {
    fontSize: 24,
  },
});
