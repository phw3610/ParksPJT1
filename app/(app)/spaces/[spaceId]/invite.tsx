import { useLocalSearchParams } from 'expo-router';
import React, { useState } from 'react';
import {
  Alert,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';

import { useAuth } from '@/auth';
import { config } from '@/lib/config';
import { supabase } from '@/lib/supabase';
import { colors, radius, spacing, typography } from '@/lib/theme';

interface GeneratedInvite {
  token: string;
  expiresAt: string;
}

export default function InviteScreen() {
  const { spaceId } = useLocalSearchParams<{ spaceId: string }>();
  const { user } = useAuth();
  const [createdInvite, setCreatedInvite] = useState<GeneratedInvite | null>(null);
  const [isGenerating, setIsGenerating] = useState(false);

  const handleCreateInvite = async () => {
    if (!spaceId || !user) return;
    setIsGenerating(true);
    try {
      const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();
      const { data, error } = await (supabase.rpc as any)('create_invite', {
        p_space_id: spaceId,
        p_role: 'member',
        p_expires_at: expiresAt,
        p_max_uses: 100,
      });

      if (error) throw error;
      const res = Array.isArray(data) ? data[0] : data;
      if (!res?.token) {
        throw new Error('초대 토큰을 발급받지 못했습니다.');
      }

      setCreatedInvite({
        token: res.token,
        expiresAt: res.expires_at || expiresAt,
      });
      Alert.alert('초대 링크 생성 완료', '초대 링크가 생성되었습니다. 링크를 복사해 전송해 주세요.');
    } catch (e: any) {
      Alert.alert('초대 생성 실패', e.message);
    } finally {
      setIsGenerating(false);
    }
  };

  const inviteUrl = createdInvite ? `${config.inviteBaseUrl}/${createdInvite.token}` : '';

  return (
    <View style={styles.container}>
      <Text style={typography.heading}>가족 초대하기</Text>
      <Text style={[typography.caption, styles.subtitle]}>
        초대 링크를 받아 앱을 실행하면 가족 앨범에 참여할 수 있습니다.
      </Text>

      {createdInvite ? (
        <View style={styles.card}>
          <Text style={styles.cardTitle}>초대 링크</Text>
          <Text style={styles.urlText} numberOfLines={2}>
            {inviteUrl}
          </Text>
          <Text style={styles.warningText}>
            ⚠️ 이 링크는 보안을 위해 생성 시 한 번만 표시됩니다. 바로 복사해서 가족에게 공유해 주세요.
          </Text>
          <Text style={[typography.caption, styles.mtSm]}>
            만료일: {new Date(createdInvite.expiresAt).toLocaleDateString('ko-KR')}
          </Text>
          <TouchableOpacity
            style={styles.copyBtn}
            onPress={() => Alert.alert('복사 완료', '초대 링크가 클립보드에 복사되었습니다.')}
          >
            <Text style={styles.copyBtnText}>링크 복사하기</Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={styles.reGenBtn}
            onPress={handleCreateInvite}
            disabled={isGenerating}
          >
            <Text style={styles.reGenText}>+ 새 초대 링크 추가 생성</Text>
          </TouchableOpacity>
        </View>
      ) : (
        <View style={styles.emptyCard}>
          <Text style={typography.body}>아직 생성된 초대 링크가 없습니다.</Text>
          <TouchableOpacity
            style={[styles.genBtn, isGenerating && styles.disabledBtn]}
            onPress={handleCreateInvite}
            disabled={isGenerating}
          >
            <Text style={styles.genBtnText}>
              {isGenerating ? '생성 중...' : '새 초대 링크 생성'}
            </Text>
          </TouchableOpacity>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.bg,
    padding: spacing.md,
  },
  subtitle: {
    marginTop: spacing.xs,
    marginBottom: spacing.lg,
  },
  card: {
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: radius.md,
    padding: spacing.md,
  },
  cardTitle: {
    color: colors.text,
    fontSize: 16,
    fontWeight: '700',
    marginBottom: spacing.xs,
  },
  urlText: {
    color: colors.primary,
    fontSize: 14,
    marginVertical: spacing.sm,
    fontWeight: '600',
  },
  warningText: {
    color: colors.warning,
    fontSize: 12,
    marginVertical: spacing.xs,
  },
  mtSm: {
    marginTop: spacing.xs,
  },
  copyBtn: {
    backgroundColor: colors.primary,
    paddingVertical: spacing.md,
    borderRadius: radius.sm,
    alignItems: 'center',
    marginTop: spacing.md,
  },
  copyBtnText: {
    color: colors.primaryText,
    fontWeight: '600',
  },
  reGenBtn: {
    paddingVertical: spacing.sm,
    alignItems: 'center',
    marginTop: spacing.sm,
  },
  reGenText: {
    color: colors.textMuted,
    fontSize: 13,
  },
  emptyCard: {
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: radius.md,
    padding: spacing.xl,
    alignItems: 'center',
  },
  genBtn: {
    backgroundColor: colors.primary,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    borderRadius: radius.md,
    marginTop: spacing.md,
  },
  genBtnText: {
    color: colors.primaryText,
    fontWeight: '600',
  },
  disabledBtn: {
    opacity: 0.6,
  },
});
