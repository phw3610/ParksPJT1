import { useLocalSearchParams, useRouter } from 'expo-router';
import React, { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';

import { useAuth } from '@/auth';
import type { StorageConnection } from '@/lib/database.types';
import { supabase } from '@/lib/supabase';
import { colors, radius, spacing, typography } from '@/lib/theme';
import { connectGoogleDrive, disconnectStorage } from '@/storage/client';

export default function ConnectStorageScreen() {
  const { spaceId } = useLocalSearchParams<{ spaceId: string }>();
  const { getGoogleServerAuthCode } = useAuth();
  const router = useRouter();

  const [connection, setConnection] = useState<StorageConnection | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isConnecting, setIsConnecting] = useState(false);

  const fetchConnection = async () => {
    if (!spaceId) return;
    try {
      const { data, error } = await supabase
        .from('storage_connections')
        .select('*')
        .eq('space_id', spaceId)
        .eq('is_active', true)
        .maybeSingle();

      if (error) throw error;
      setConnection(data);
    } catch {
      /* 무시 */
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    fetchConnection();
  }, [spaceId]);

  const handleConnectDrive = async () => {
    if (!spaceId) return;
    setIsConnecting(true);
    try {
      const serverAuthCode = await getGoogleServerAuthCode();
      await connectGoogleDrive(spaceId, serverAuthCode);
      Alert.alert('연결 성공', 'Google 드라이브가 연결되었습니다.');
      await fetchConnection();
    } catch (e: any) {
      Alert.alert('연결 실패', e.message || 'Google 드라이브를 연결하지 못했습니다.');
    } finally {
      setIsConnecting(false);
    }
  };

  const handleDisconnect = async () => {
    if (!spaceId) return;
    Alert.alert('저장소 연결 해제', '저장소 연결을 해제하시겠습니까? 원본 파일은 삭제되지 않습니다.', [
      { text: '취소', style: 'cancel' },
      {
        text: '해제',
        style: 'destructive',
        onPress: async () => {
          try {
            await disconnectStorage(spaceId, true);
            setConnection(null);
            fetchConnection();
          } catch (e: any) {
            Alert.alert('오류', e.message);
          }
        },
      },
    ]);
  };

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <Text style={typography.heading}>사진을 어디에 저장할까요?</Text>
      <Text style={[typography.caption, styles.subText]}>
        원본 사진은 선택한 저장소에만 보관되며, 앱 서버에는 저장되지 않습니다.
      </Text>

      {isLoading ? (
        <ActivityIndicator size="large" color={colors.primary} style={styles.loader} />
      ) : (
        <View style={styles.cardList}>
          {/* 1. Google Drive Card */}
          <View style={styles.card}>
            <View style={styles.cardHeader}>
              <Text style={styles.cardTitle}>
                {connection ? '✅ Google 드라이브' : '● Google 드라이브'}
              </Text>
              {connection ? (
                <View style={styles.row}>
                  <TouchableOpacity style={styles.actionBtn} onPress={handleConnectDrive}>
                    <Text style={styles.actionBtnText}>재인증</Text>
                  </TouchableOpacity>
                  <TouchableOpacity style={[styles.actionBtn, styles.dangerBtn]} onPress={handleDisconnect}>
                    <Text style={styles.dangerBtnText}>해제</Text>
                  </TouchableOpacity>
                </View>
              ) : (
                <TouchableOpacity
                  style={[styles.connectBtn, isConnecting && styles.disabledBtn]}
                  onPress={handleConnectDrive}
                  disabled={isConnecting}
                >
                  <Text style={styles.connectBtnText}>
                    {isConnecting ? '연결 중...' : '연결하기'}
                  </Text>
                </TouchableOpacity>
              )}
            </View>

            {connection && (
              <View style={styles.connInfo}>
                <Text style={styles.accountLabel}>{connection.account_label || '연결됨'}</Text>
                {connection.last_error && (
                  <Text style={styles.errorText}>⚠️ {connection.last_error}</Text>
                )}
              </View>
            )}
          </View>

          {/* 2. NAVER MYBOX Card */}
          <View style={[styles.card, styles.disabledCard]}>
            <Text style={styles.cardTitle}>⏳ 네이버 MYBOX</Text>
            <Text style={[typography.caption, styles.cardDesc]}>
              네이버 공식 API 공개를 기다리는 중입니다. 공개되면 바로 지원할게요.
            </Text>
            <TouchableOpacity
              style={styles.noticeBtn}
              onPress={() => Alert.alert('알림 등록', 'MYBOX 지원 시 알림을 받아보실 수 있습니다.')}
            >
              <Text style={styles.noticeBtnText}>공개되면 알림 받기</Text>
            </TouchableOpacity>
          </View>

          {/* 3. Personal NAS Card */}
          <View style={[styles.card, styles.disabledCard]}>
            <Text style={styles.cardTitle}>🔜 개인 NAS</Text>
            <Text style={[typography.caption, styles.cardDesc]}>
              WebDAV · S3 호환 지원 예정 (Phase 2)
            </Text>
          </View>
        </View>
      )}

      <TouchableOpacity
        style={styles.doneBtn}
        onPress={() => router.replace(`/(app)/spaces/${spaceId}`)}
      >
        <Text style={styles.doneBtnText}>
          {connection ? '완료 (스페이스 홈으로)' : '나중에 연결하기'}
        </Text>
      </TouchableOpacity>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.bg,
  },
  content: {
    padding: spacing.md,
  },
  subText: {
    marginTop: spacing.xs,
    marginBottom: spacing.lg,
  },
  loader: {
    marginVertical: spacing.xl,
  },
  cardList: {
    gap: spacing.md,
    marginBottom: spacing.xl,
  },
  card: {
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: radius.md,
    padding: spacing.md,
  },
  disabledCard: {
    opacity: 0.75,
  },
  cardHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  cardTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: colors.text,
  },
  row: {
    flexDirection: 'row',
    gap: spacing.xs,
  },
  connectBtn: {
    backgroundColor: colors.primary,
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: radius.sm,
  },
  connectBtnText: {
    color: colors.primaryText,
    fontWeight: '600',
    fontSize: 13,
  },
  actionBtn: {
    backgroundColor: colors.surfaceAlt,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: radius.sm,
  },
  actionBtnText: {
    color: colors.text,
    fontSize: 12,
  },
  dangerBtn: {
    backgroundColor: 'rgba(248, 113, 113, 0.2)',
  },
  dangerBtnText: {
    color: colors.danger,
    fontSize: 12,
  },
  connInfo: {
    marginTop: spacing.sm,
    paddingTop: spacing.xs,
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
  accountLabel: {
    color: colors.primary,
    fontSize: 14,
    fontWeight: '500',
  },
  errorText: {
    color: colors.warning,
    fontSize: 12,
    marginTop: 2,
  },
  cardDesc: {
    marginTop: spacing.xs,
  },
  noticeBtn: {
    marginTop: spacing.sm,
    alignSelf: 'flex-start',
  },
  noticeBtnText: {
    color: colors.primary,
    fontSize: 13,
  },
  doneBtn: {
    backgroundColor: colors.surfaceAlt,
    paddingVertical: spacing.md,
    borderRadius: radius.md,
    alignItems: 'center',
    marginBottom: spacing.xl,
  },
  doneBtnText: {
    color: colors.text,
    fontSize: 15,
    fontWeight: '600',
  },
  disabledBtn: {
    opacity: 0.6,
  },
});
