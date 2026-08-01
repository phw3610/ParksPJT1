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

import { useAuth } from '@/auth';
import { supabase } from '@/lib/supabase';
import { colors, radius, spacing, typography } from '@/lib/theme';

interface InvitePreview {
  space_name: string;
  inviter_name: string;
  member_count: number;
  asset_count: number;
}

export default function AcceptInviteScreen() {
  const { token } = useLocalSearchParams<{ token: string }>();
  const { session, isLoading: authLoading } = useAuth();
  const router = useRouter();

  const [preview, setPreview] = useState<InvitePreview | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isAccepting, setIsAccepting] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  useEffect(() => {
    if (!token) return;

    const fetchPreview = async () => {
      try {
        const { data, error } = await (supabase.rpc as any)('preview_invite', { p_token: token });
        if (error) throw error;
        if (data && data.length > 0) {
          setPreview(data[0]);
        } else {
          setErrorMsg('만료되거나 올바르지 않은 초대 링크입니다.');
        }
      } catch (e: any) {
        setErrorMsg(e.message || '초대 정보를 불러오지 못했습니다.');
      } finally {
        setIsLoading(false);
      }
    };

    fetchPreview();
  }, [token]);

  const handleAccept = async () => {
    if (!token) return;
    if (!session) {
      router.push('/(auth)/login');
      return;
    }

    setIsAccepting(true);
    try {
      const { data: spaceId, error } = await (supabase.rpc as any)('accept_invite', { p_token: token });
      if (error) throw error;

      Alert.alert('참여 완료!', '가족 앨범에 참여했습니다.');
      router.replace(`/(app)/spaces/${spaceId}`);
    } catch (e: any) {
      Alert.alert('참여 실패', e.message || '초대를 수락하지 못했습니다.');
    } finally {
      setIsAccepting(false);
    }
  };

  if (authLoading || isLoading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator size="large" color={colors.primary} />
      </View>
    );
  }

  if (errorMsg || !preview) {
    return (
      <View style={styles.container}>
        <View style={styles.card}>
          <Text style={[typography.heading, styles.errorTitle]}>초대 링크 오류</Text>
          <Text style={[typography.body, styles.errorText]}>
            {errorMsg || '만료된 초대 링크예요.\n초대한 분에게 새 링크를 요청해 주세요'}
          </Text>
          <TouchableOpacity style={styles.btn} onPress={() => router.replace('/')}>
            <Text style={styles.btnText}>홈으로 돌아가기</Text>
          </TouchableOpacity>
        </View>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <View style={styles.card}>
        <Text style={styles.inviteBadge}>초대받음</Text>
        <Text style={styles.spaceTitle}>[{preview.space_name}] 앨범에 초대됐어요</Text>

        <View style={styles.infoBox}>
          <Text style={styles.infoRow}>초대한 사람: {preview.inviter_name}</Text>
          <Text style={styles.infoRow}>
            멤버 {preview.member_count}명 · 사진 {preview.asset_count}장
          </Text>
        </View>

        <Text style={styles.privacyNote}>
          ※ 원본 사진은 소유자 클라우드에 보관됩니다.
        </Text>

        <View style={styles.actions}>
          <TouchableOpacity
            style={[styles.btn, isAccepting && styles.disabledBtn]}
            onPress={handleAccept}
            disabled={isAccepting}
          >
            <Text style={styles.btnText}>
              {isAccepting ? '참여 중...' : '참여하기'}
            </Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.rejectBtn} onPress={() => router.replace('/')}>
            <Text style={styles.rejectText}>거절</Text>
          </TouchableOpacity>
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.bg,
    padding: spacing.lg,
    justifyContent: 'center',
  },
  center: {
    flex: 1,
    backgroundColor: colors.bg,
    justifyContent: 'center',
    alignItems: 'center',
  },
  card: {
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: radius.md,
    padding: spacing.xl,
    alignItems: 'center',
  },
  inviteBadge: {
    backgroundColor: colors.surfaceAlt,
    color: colors.primary,
    fontSize: 12,
    fontWeight: '600',
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: radius.sm,
    marginBottom: spacing.md,
  },
  spaceTitle: {
    color: colors.text,
    fontSize: 20,
    fontWeight: '700',
    textAlign: 'center',
    marginBottom: spacing.lg,
  },
  infoBox: {
    backgroundColor: colors.surfaceAlt,
    borderRadius: radius.sm,
    padding: spacing.md,
    width: '100%',
    marginBottom: spacing.md,
  },
  infoRow: {
    color: colors.text,
    fontSize: 14,
    textAlign: 'center',
    marginVertical: 2,
  },
  privacyNote: {
    color: colors.textMuted,
    fontSize: 12,
    marginBottom: spacing.xl,
    textAlign: 'center',
  },
  actions: {
    width: '100%',
    gap: spacing.sm,
  },
  btn: {
    backgroundColor: colors.primary,
    paddingVertical: spacing.md,
    borderRadius: radius.md,
    alignItems: 'center',
  },
  btnText: {
    color: colors.primaryText,
    fontWeight: '600',
    fontSize: 16,
  },
  rejectBtn: {
    paddingVertical: spacing.sm,
    alignItems: 'center',
  },
  rejectText: {
    color: colors.textMuted,
    fontSize: 14,
  },
  errorTitle: {
    color: colors.danger,
    marginBottom: spacing.sm,
  },
  errorText: {
    textAlign: 'center',
    marginBottom: spacing.lg,
  },
  disabledBtn: {
    opacity: 0.6,
  },
});
