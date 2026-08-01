import { useLocalSearchParams } from 'expo-router';
import React, { useEffect, useState } from 'react';
import {
  Alert,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';

import { useAuth } from '@/auth';
import { config } from '@/lib/config';
import type { Invite } from '@/lib/database.types';
import { supabase } from '@/lib/supabase';
import { colors, radius, spacing, typography } from '@/lib/theme';

export default function InviteScreen() {
  const { spaceId } = useLocalSearchParams<{ spaceId: string }>();
  const { user } = useAuth();
  const [invite, setInvite] = useState<Invite | null>(null);
  const [isGenerating, setIsGenerating] = useState(false);

  const fetchExistingInvite = async () => {
    if (!spaceId) return;
    const { data } = await supabase
      .from('invites')
      .select('*')
      .eq('space_id', spaceId)
      .is('revoked_at', null)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    setInvite(data);
  };

  useEffect(() => {
    fetchExistingInvite();
  }, [spaceId]);

  const handleCreateInvite = async () => {
    if (!spaceId || !user) return;
    setIsGenerating(true);
    try {
      const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();
      const { data, error } = await (supabase.from('invites') as any)
        .insert({
          space_id: spaceId,
          role: 'member',
          created_by: user.id,
          expires_at: expiresAt,
          max_uses: 100,
        })
        .select()
        .single();

      if (error) throw error;
      setInvite(data);
      Alert.alert('초대 링크 생성 완료', '초대 링크가 생성되었습니다.');
    } catch (e: any) {
      Alert.alert('초대 생성 실패', e.message);
    } finally {
      setIsGenerating(false);
    }
  };

  const inviteUrl = invite ? `${config.inviteBaseUrl}/${invite.id}` : '';

  return (
    <View style={styles.container}>
      <Text style={typography.heading}>가족 초대하기</Text>
      <Text style={[typography.caption, styles.subtitle]}>
        초대 링크를 받아 앱을 실행하면 가족 앨범에 참여할 수 있습니다.
      </Text>

      {invite ? (
        <View style={styles.card}>
          <Text style={styles.cardTitle}>초대 링크</Text>
          <Text style={styles.urlText} numberOfLines={2}>
            {inviteUrl}
          </Text>
          <Text style={typography.caption}>
            만료일: {new Date(invite.expires_at).toLocaleDateString('ko-KR')}
          </Text>
          <TouchableOpacity
            style={styles.copyBtn}
            onPress={() => Alert.alert('복사 완료', '초대 링크가 복사되었습니다.')}
          >
            <Text style={styles.copyBtnText}>링크 복사하기</Text>
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
