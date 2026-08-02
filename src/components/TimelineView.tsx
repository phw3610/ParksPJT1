import { Image } from 'expo-image';
import { useRouter } from 'expo-router';
import React, { useCallback, useEffect, useRef, useState } from 'react';
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

/**
 * 3열 그리드 기준: 1개 뷰포트에 약 4줄(12장)이 들어감.
 * 3개 뷰포트 분량인 36장을 1페이지 단위로 지정하여,
 * 그리드 줄이 3열 단위로 끊어지지 않고 네트워크 요청 횟수를 줄임.
 */
const PAGE_SIZE = 36;

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

/**
 * 정렬된 전체 assets 배열을 날짜별(captured_at ?? created_at)로 그룹핑.
 * 페이지네이션으로 추가된 사진도 동일 날짜 그룹에 병합되므로 같은 날짜 헤더가 중복 생성되지 않음.
 */
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
  const [isFetchingMore, setIsFetchingMore] = useState(false);
  const [hasMore, setHasMore] = useState(true);

  const assetsRef = useRef<Asset[]>([]);
  assetsRef.current = assets;

  // 3열 그리드 항목 크기 계산
  const numColumns = 3;
  const gap = spacing.xs;
  const padding = spacing.md;
  const itemSize = Math.floor((width - padding * 2 - gap * (numColumns - 1)) / numColumns);

  // 1. 초기 1페이지(0 ~ PAGE_SIZE - 1) 조회
  const fetchInitialTimelineAssets = useCallback(async () => {
    if (!spaceId) return;
    try {
      const { data, error } = await supabase
        .from('assets')
        .select('*')
        .eq('space_id', spaceId)
        .is('deleted_at', null)
        .order('captured_at', { ascending: false, nullsFirst: false })
        .order('created_at', { ascending: false })
        .range(0, PAGE_SIZE - 1);

      if (error) throw error;

      const loadedAssets = (data as Asset[] | null) || [];
      setAssets(loadedAssets);
      setSections(groupAssetsByDate(loadedAssets));
      setHasMore(loadedAssets.length >= PAGE_SIZE);

      // 서명 URL은 불러온 범위에 대해서만 개별 발급
      if (loadedAssets.length > 0) {
        const urls = await createThumbnailSignedUrls(loadedAssets);
        setThumbnailUrls(urls);
      } else {
        setThumbnailUrls({});
      }
    } catch {
      setAssets([]);
      setSections([]);
      setThumbnailUrls({});
      setHasMore(false);
    } finally {
      setIsLoading(false);
      setIsRefreshing(false);
    }
  }, [spaceId]);

  useEffect(() => {
    void fetchInitialTimelineAssets();
  }, [fetchInitialTimelineAssets]);

  // 2. 추가 페이지 무한 스크롤 조회 (onEndReached)
  const fetchMoreTimelineAssets = async () => {
    if (isFetchingMore || !hasMore || isLoading || isRefreshing || !spaceId) return;

    setIsFetchingMore(true);
    try {
      const currentLoaded = assetsRef.current;
      const from = currentLoaded.length;
      const to = from + PAGE_SIZE - 1;

      const { data, error } = await supabase
        .from('assets')
        .select('*')
        .eq('space_id', spaceId)
        .is('deleted_at', null)
        .order('captured_at', { ascending: false, nullsFirst: false })
        .order('created_at', { ascending: false })
        .range(from, to);

      if (error) throw error;

      const newFetched = (data as Asset[] | null) || [];
      if (newFetched.length < PAGE_SIZE) {
        setHasMore(false);
      }

      // 기존 불러온 항목과 중복되는 ID 필터링 (스크롤 시 신규 사진 추가 등으로 인한 오프셋 밀림 방지)
      const existingIds = new Set(currentLoaded.map((a) => a.id));
      const uniqueNewAssets = newFetched.filter((a) => !existingIds.has(a.id));

      if (uniqueNewAssets.length > 0) {
        const combined = [...currentLoaded, ...uniqueNewAssets];
        setAssets(combined);
        setSections(groupAssetsByDate(combined));

        // 새로 추가된 사진 몫에 대해서만 서명 URL 추가 발급 (기존 발급 URL 유지)
        const newUrls = await createThumbnailSignedUrls(uniqueNewAssets);
        setThumbnailUrls((prev) => ({ ...prev, ...newUrls }));
      }
    } catch {
      /* 에러 시 다음 스크롤에서 재시도할 수 있도록 상태 해제 */
    } finally {
      setIsFetchingMore(false);
    }
  };

  // 3. 로드된 전체 assets 썸네일 서명 URL 주기적 갱신 (만료 방지)
  useEffect(() => {
    if (assets.length === 0) return;

    let isCancelled = false;
    const refreshThumbnailUrls = async () => {
      try {
        const urls = await createThumbnailSignedUrls(assetsRef.current);
        if (!isCancelled) {
          setThumbnailUrls(urls);
        }
      } catch {
        /* 무시 */
      }
    };

    const refreshTimer = setInterval(() => {
      void refreshThumbnailUrls();
    }, THUMBNAIL_URL_REFRESH_MS);

    return () => {
      isCancelled = true;
      clearInterval(refreshTimer);
    };
  }, [assets.length]);

  const handleRefresh = () => {
    setIsRefreshing(true);
    setHasMore(true);
    void fetchInitialTimelineAssets();
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
      onEndReached={fetchMoreTimelineAssets}
      onEndReachedThreshold={0.5}
      refreshControl={
        <RefreshControl
          refreshing={isRefreshing}
          onRefresh={handleRefresh}
          tintColor={colors.primary}
        />
      }
      ListFooterComponent={
        isFetchingMore ? (
          <View style={styles.footerLoader}>
            <ActivityIndicator size="small" color={colors.primary} />
          </View>
        ) : null
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
                  router.push({
                    pathname: '/(app)/spaces/[spaceId]/asset/[assetId]',
                    params: { spaceId, assetId: asset.id, source: 'timeline' },
                  })
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
  footerLoader: {
    paddingVertical: spacing.md,
    alignItems: 'center',
  },
});
