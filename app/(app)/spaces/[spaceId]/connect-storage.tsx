import { useLocalSearchParams, useRouter } from 'expo-router';
import React, { useCallback, useEffect, useState } from 'react';
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
import type { MemberRole, StorageConnection } from '@/lib/database.types';
import { supabase } from '@/lib/supabase';
import { colors, radius, spacing, typography } from '@/lib/theme';
import { queueManager } from '@/queue';
import { connectGoogleDrive, disconnectStorage } from '@/storage/client';

export default function ConnectStorageScreen() {
  const { spaceId } = useLocalSearchParams<{ spaceId: string }>();
  const { user, getGoogleServerAuthCode } = useAuth();
  const router = useRouter();

  const [connection, setConnection] = useState<StorageConnection | null>(null);
  const [connectionError, setConnectionError] = useState<string | null>(null);
  const [userRole, setUserRole] = useState<MemberRole | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isConnecting, setIsConnecting] = useState(false);

  const fetchConnection = useCallback(async (): Promise<StorageConnection | null> => {
    if (!spaceId || !user) return null;
    setIsLoading(true);
    try {
      // 1. Fetch user role
      const { data: memberData } = await (supabase.from('space_members') as any)
        .select('role')
        .eq('space_id', spaceId)
        .eq('user_id', user.id)
        .maybeSingle();

      if (memberData) {
        setUserRole(memberData.role);
      }

      // 2. Fetch storage connection
      const { data, error } = await supabase
        .from('storage_connections')
        .select(
          'id,space_id,provider,connected_by,account_label,root_folder_id,is_active,last_error,last_verified_at,created_at',
        )
        .eq('space_id', spaceId)
        .eq('is_active', true)
        .maybeSingle();

      if (error) throw error;
      setConnection(data);
      setConnectionError(null);
      return data;
    } catch (error) {
      const message =
        typeof error === 'object' && error !== null && 'message' in error
          ? String(error.message)
          : '저장소 연결 상태를 불러오지 못했습니다.';
      setConnectionError(message);
      throw error;
    } finally {
      setIsLoading(false);
    }
  }, [spaceId, user]);

  useEffect(() => {
    void fetchConnection().catch(() => undefined);
  }, [fetchConnection]);

  const handleConnectDrive = async () => {
    if (!spaceId) return;
    if (userRole !== 'owner') {
      Alert.alert('권한 없음', '스토리지 연결은 앨범 소유자(Owner)만 가능합니다.');
      return;
    }
    setIsConnecting(true);
    try {
      const serverAuthCode = await getGoogleServerAuthCode();
      await connectGoogleDrive(spaceId, serverAuthCode);
      const confirmedConnection = await fetchConnection();
      if (!confirmedConnection) {
        throw new Error('연결 정보를 확인하지 못했습니다. 잠시 후 다시 시도해 주세요.');
      }
      await queueManager.resume(spaceId);
      Alert.alert('연결 성공', 'Google 드라이브가 연결되었습니다.');
    } catch (e: any) {
      Alert.alert('연결 실패', e.message || 'Google 드라이브를 연결하지 못했습니다.');
    } finally {
      setIsConnecting(false);
    }
  };

  const handleDisconnect = async () => {
    if (!spaceId) return;
    if (userRole !== 'owner') {
      Alert.alert('권한 없음', '스토리지 연결 해제는 앨범 소유자(Owner)만 가능합니다.');
      return;
    }
    Alert.alert('저장소 연결 해제', '저장소 연결을 해제하시겠습니까? 원본 파일은 삭제되지 않습니다.', [
      { text: '취소', style: 'cancel' },
      {
        text: '해제',
        style: 'destructive',
        onPress: async () => {
          try {
            await disconnectStorage(spaceId, true);
            setConnection(null);
            await fetchConnection();
          } catch (e: any) {
            Alert.alert('오류', e.message);
          }
        },
      },
    ]);
  };

  // Guard for non-owner users
  if (!isLoading && userRole && userRole !== 'owner') {
    return (
      <View style={styles.guardContainer}>
        <View style={styles.guardCard}>
          <Text style={typography.heading}>🔒 권한 제한</Text>
          <Text style={[typography.body, styles.guardText]}>
            스토리지 연결 및 관리 권한은 앨범 소유자(Owner)에게만 부여됩니다.
          </Text>
          <TouchableOpacity
            style={styles.doneBtn}
            onPress={() => router.replace(`/(app)/spaces/${spaceId}`)}
          >
            <Text style={styles.doneBtnText}>앨범 홈으로 돌아가기</Text>
          </TouchableOpacity>
        </View>
      </View>
    );
  }

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <Text style={typography.heading}>사진을 어디에 저장할까요?</Text>
      <Text style={[typography.caption, styles.subText]}>
        원본 사진은 선택한 저장소에만 보관되며, 앱 서버에는 저장되지 않습니다.
      </Text>

      {connectionError && (
        <View style={styles.loadErrorBanner}>
          <Text style={styles.loadErrorText}>연결 상태 조회 실패: {connectionError}</Text>
          <TouchableOpacity
            onPress={() => void fetchConnection().catch(() => undefined)}
            accessibilityRole="button"
          >
            <Text style={styles.retryText}>다시 시도</Text>
          </TouchableOpacity>
        </View>
      )}

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
  guardContainer: {
    flex: 1,
    backgroundColor: colors.bg,
    padding: spacing.lg,
    justifyContent: 'center',
  },
  guardCard: {
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: radius.md,
    padding: spacing.lg,
    alignItems: 'center',
  },
  guardText: {
    marginVertical: spacing.md,
    textAlign: 'center',
  },
  subText: {
    marginTop: spacing.xs,
    marginBottom: spacing.lg,
  },
  loader: {
    marginVertical: spacing.xl,
  },
  loadErrorBanner: {
    marginBottom: spacing.md,
    padding: spacing.sm,
    borderWidth: 1,
    borderColor: colors.danger,
    borderRadius: radius.sm,
    backgroundColor: 'rgba(248, 113, 113, 0.12)',
  },
  loadErrorText: {
    color: colors.danger,
    fontSize: 13,
  },
  retryText: {
    marginTop: spacing.xs,
    color: colors.primary,
    fontSize: 13,
    fontWeight: '600',
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
    paddingHorizontal: spacing.lg,
    borderRadius: radius.md,
    alignItems: 'center',
    marginBottom: spacing.xl,
    width: '100%',
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
