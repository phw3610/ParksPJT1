import { useLocalSearchParams } from 'expo-router';
import React, { useState } from 'react';
import {
  Alert,
  Clipboard,
  Platform,
  Share,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';

import { useAuth } from '@/auth';
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
        throw new Error('초대 코드를 발급받지 못했습니다.');
      }

      setCreatedInvite({
        token: res.token,
        expiresAt: res.expires_at || expiresAt,
      });
      Alert.alert('초대 코드 생성 완료', '초대 코드가 생성되었습니다. 코드를 복사하거나 공유해 주세요.');
    } catch (e: any) {
      Alert.alert('초대 생성 실패', e.message || '초대 코드를 생성하지 못했습니다.');
    } finally {
      setIsGenerating(false);
    }
  };

  const handleCopyCode = () => {
    if (!createdInvite) return;
    Clipboard.setString(createdInvite.token);
    Alert.alert('복사 완료', '초대 코드가 클립보드에 복사되었습니다.');
  };

  const handleShareCode = async () => {
    if (!createdInvite) return;
    try {
      await Share.share({
        message: `[가족 앨범] 초대 코드입니다.\n\n초대 코드: ${createdInvite.token}\n\n가족 앨범 앱을 실행한 후 '코드로 참여' 메뉴에 입력해 주세요.`,
      });
    } catch (e: any) {
      Alert.alert('공유 실패', e.message);
    }
  };

  // 8글자 단위로 보기 좋게 구분 (복사/공유 시에는 원본 createdInvite.token 사용)
  const formattedTokenDisplay = createdInvite
    ? createdInvite.token.match(/.{1,8}/g)?.join(' ') ?? createdInvite.token
    : '';

  return (
    <View style={styles.container}>
      <Text style={typography.heading}>가족 초대하기</Text>
      <Text style={[typography.caption, styles.subtitle]}>
        초대 코드를 받은 가족은 앱에서 '코드로 참여'를 통해 앨범에 참여할 수 있습니다.
      </Text>

      {createdInvite ? (
        <View style={styles.card}>
          <Text style={styles.cardTitle}>초대 코드</Text>
          <View style={styles.codeContainer}>
            <Text style={styles.codeText} selectable>
              {formattedTokenDisplay}
            </Text>
          </View>

          <Text style={styles.warningText}>
            ⚠️ 이 초대 코드는 보안상 생성 시 단 한 번만 표시됩니다. 다시 조회할 수 없으니 바로 복사하거나 메시지로 공유해 주세요.
          </Text>

          <Text style={[typography.caption, styles.mtSm]}>
            만료일: {new Date(createdInvite.expiresAt).toLocaleDateString('ko-KR')}
          </Text>

          <TouchableOpacity style={styles.copyBtn} onPress={handleCopyCode}>
            <Text style={styles.copyBtnText}>📋 초대 코드 복사하기</Text>
          </TouchableOpacity>

          <TouchableOpacity style={styles.shareBtn} onPress={handleShareCode}>
            <Text style={styles.shareBtnText}>💬 카카오톡 / 메시지로 보내기</Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={styles.reGenBtn}
            onPress={handleCreateInvite}
            disabled={isGenerating}
          >
            <Text style={styles.reGenText}>+ 새 초대 코드 추가 생성</Text>
          </TouchableOpacity>
        </View>
      ) : (
        <View style={styles.emptyCard}>
          <Text style={typography.body}>아직 생성된 초대 코드가 없습니다.</Text>
          <TouchableOpacity
            style={[styles.genBtn, isGenerating && styles.disabledBtn]}
            onPress={handleCreateInvite}
            disabled={isGenerating}
          >
            <Text style={styles.genBtnText}>
              {isGenerating ? '생성 중...' : '새 초대 코드 생성'}
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
  codeContainer: {
    backgroundColor: colors.surfaceAlt,
    borderRadius: radius.sm,
    padding: spacing.md,
    marginVertical: spacing.sm,
    borderWidth: 1,
    borderColor: colors.border,
  },
  codeText: {
    color: colors.primary,
    fontSize: 14,
    fontWeight: '700',
    fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
    textAlign: 'center',
    lineHeight: 20,
  },
  warningText: {
    color: colors.warning,
    fontSize: 12,
    marginVertical: spacing.xs,
    lineHeight: 16,
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
    fontSize: 15,
  },
  shareBtn: {
    backgroundColor: colors.surfaceAlt,
    paddingVertical: spacing.md,
    borderRadius: radius.sm,
    alignItems: 'center',
    marginTop: spacing.sm,
    borderWidth: 1,
    borderColor: colors.border,
  },
  shareBtnText: {
    color: colors.text,
    fontWeight: '600',
    fontSize: 15,
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
