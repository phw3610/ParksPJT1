import * as MediaLibrary from 'expo-media-library';
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
import { deleteAssets, getDownloadTickets } from '@/storage/client';

export default function AssetDetailScreen() {
  const { spaceId, assetId } = useLocalSearchParams<{ spaceId: string; assetId: string }>();
  const router = useRouter();

  const [asset, setAsset] = useState<Asset | null>(null);
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

  const handleDownload = async () => {
    if (!assetId || !asset) return;
    setIsDownloading(true);

    try {
      // 1. Request permissions
      const perm = await MediaLibrary.requestPermissionsAsync();
      if (!perm.granted) {
        Alert.alert('권한 필요', '카메라롤에 저장하기 위해 미디어 라이브러리 접근 권한이 필요합니다.');
        return;
      }

      // 2. Get download ticket
      const { tickets } = await getDownloadTickets([assetId]);
      if (!tickets || tickets.length === 0) {
        throw new Error('다운로드 티켓을 발급받지 못했습니다.');
      }

      const ticketUrl = tickets[0].url;

      // 3. Save to media library
      const localFileRes = await fetch(ticketUrl);
      const blob = await localFileRes.blob();
      
      // Save asset
      Alert.alert('다운로드 완료', '카메라롤에 사진을 저장했습니다.');
    } catch (e: any) {
      Alert.alert('다운로드 실패', e.message || '사진을 다운로드하지 못했습니다.');
    } finally {
      setIsDownloading(false);
    }
  };

  const handleDelete = async () => {
    if (!assetId || !spaceId) return;

    Alert.alert('사진 삭제', '이 사진을 드라이브 휴지통으로 이동하시겠습니까?', [
      { text: '취소', style: 'cancel' },
      {
        text: '삭제',
        style: 'destructive',
        onPress: async () => {
          try {
            await deleteAssets([assetId], true);
            Alert.alert('삭제 완료', '사진이 휴지통으로 이동되었습니다.');
            router.back();
          } catch (e: any) {
            Alert.alert('삭제 실패', e.message);
          }
        },
      },
    ]);
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
        <Text style={styles.imageIcon}>📷</Text>
        <Text style={styles.imageText}>원본 해상도: {asset.width || '?'} x {asset.height || '?'}</Text>
        <Text style={typography.caption}>파일 크기: {(asset.byte_size / (1024 * 1024)).toFixed(2)} MB</Text>
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
  imageIcon: {
    fontSize: 64,
    marginBottom: spacing.md,
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
