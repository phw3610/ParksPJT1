import { Image } from 'expo-image';
import { useFocusEffect, useRouter } from 'expo-router';
import React, { useCallback, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  RefreshControl,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';

import { useAuth } from '@/auth';
import { VideoBadge } from '@/components/VideoBadge';
import type { Asset } from '@/lib/database.types';
import { supabase } from '@/lib/supabase';
import { colors, radius, spacing, typography } from '@/lib/theme';
import { createThumbnailSignedUrls } from '@/storage/thumbnails';

export interface FavoritesViewProps {
  spaceId: string;
}

/** 내가 별을 붙인 사진만 모아 보여준다. 즐겨찾기는 개인 북마크라 남의 것은 보이지 않는다. */
export function FavoritesView({ spaceId }: FavoritesViewProps) {
  const { user } = useAuth();
  const userId = user?.id;
  const router = useRouter();

  const [assets, setAssets] = useState<Asset[]>([]);
  const [thumbnailUrls, setThumbnailUrls] = useState<Record<string, string>>({});
  const [isLoading, setIsLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);

  const fetchFavorites = useCallback(async () => {
    if (!spaceId || !userId) return;

    try {
      const { data, error } = await supabase
        .from('favorites')
        .select('created_at, assets(*)')
        .eq('space_id', spaceId)
        .eq('user_id', userId)
        .order('created_at', { ascending: false });

      if (error) throw error;

      // assets 쪽 RLS가 삭제된 것을 걸러 주므로 즐겨찾기가 남아 있어도 사진이 없을 수 있다.
      const items = ((data as any[]) || [])
        .map((row) => row.assets as Asset | null)
        .filter((asset): asset is Asset => Boolean(asset) && !asset!.deleted_at);

      setAssets(items);
      setThumbnailUrls(await createThumbnailSignedUrls(items));
    } catch (error) {
      console.warn('[favorites] 즐겨찾기를 불러오지 못했습니다.', error);
      setAssets([]);
    }
  }, [spaceId, userId]);

  useFocusEffect(
    useCallback(() => {
      let isCancelled = false;
      const load = async () => {
        setIsLoading(true);
        await fetchFavorites();
        if (!isCancelled) setIsLoading(false);
      };
      void load();
      return () => {
        isCancelled = true;
      };
    }, [fetchFavorites]),
  );

  const onRefresh = async () => {
    setIsRefreshing(true);
    await fetchFavorites();
    setIsRefreshing(false);
  };

  if (isLoading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator size="large" color={colors.primary} />
      </View>
    );
  }

  return (
    <FlatList
      data={assets}
      keyExtractor={(item) => item.id}
      numColumns={3}
      refreshControl={
        <RefreshControl refreshing={isRefreshing} onRefresh={onRefresh} tintColor={colors.primary} />
      }
      ListEmptyComponent={
        <View style={styles.empty}>
          <Text style={styles.emptyIcon}>⭐</Text>
          <Text style={typography.heading}>즐겨찾기가 비어 있어요</Text>
          <Text style={typography.caption}>사진을 열고 ☆를 누르면 여기에 모입니다</Text>
        </View>
      }
      renderItem={({ item }) => {
        const thumbnailUrl = thumbnailUrls[item.id];
        return (
          <TouchableOpacity
            style={styles.cell}
            activeOpacity={0.8}
            onPress={() =>
              router.push({
                pathname: '/(app)/spaces/[spaceId]/asset/[assetId]',
                params: { spaceId, assetId: item.id },
              })
            }
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
                <Text style={styles.placeholderIcon}>
                  {item.kind === 'video' ? '🎬' : '📷'}
                </Text>
              )}
              {item.kind === 'video' && <VideoBadge durationMs={item.duration_ms} />}
            </View>
          </TouchableOpacity>
        );
      }}
    />
  );
}

const styles = StyleSheet.create({
  center: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
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
  placeholderIcon: {
    fontSize: 24,
  },
});
