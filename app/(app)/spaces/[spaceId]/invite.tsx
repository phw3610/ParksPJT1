import { useLocalSearchParams } from 'expo-router';
import React, { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Clipboard,
  Platform,
  ScrollView,
  Share,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';

import { useAuth } from '@/auth';
import type { Invite, MemberRole } from '@/lib/database.types';
import { supabase } from '@/lib/supabase';
import { colors, radius, spacing, typography } from '@/lib/theme';

type InviteRole = Exclude<MemberRole, 'owner'>;
type InviteStatus = 'valid' | 'expired' | 'exhausted' | 'revoked';

interface GeneratedInvite {
  id: string;
  token: string;
  expiresAt: string;
  role: InviteRole;
  maxUses: number;
}

const ROLE_OPTIONS: { value: InviteRole; label: string; description: string }[] = [
  {
    value: 'member',
    label: '멤버',
    description: '사진을 올리고 폴더를 정리할 수 있어요. 멤버와 초대는 관리할 수 없어요.',
  },
  {
    value: 'viewer',
    label: '보기 전용',
    description: '사진과 폴더를 볼 수 있지만 내용을 변경할 수 없어요.',
  },
  {
    value: 'admin',
    label: '관리자',
    description: '사진·폴더를 변경하고 멤버와 초대를 관리할 수 있어요.',
  },
];

const EXPIRY_OPTIONS = [
  { days: 1, label: '1일' },
  { days: 7, label: '7일' },
  { days: 30, label: '30일' },
];

const USE_OPTIONS = [
  { count: 1, label: '1회용' },
  { count: 3, label: '3명' },
  { count: 10, label: '10명' },
];

const INVITE_COLUMNS =
  'id, space_id, role, created_by, expires_at, max_uses, used_count, revoked_at, created_at';

function getRoleLabel(role: MemberRole) {
  switch (role) {
    case 'owner':
      return '소유자';
    case 'admin':
      return '관리자';
    case 'member':
      return '멤버';
    case 'viewer':
      return '보기 전용';
  }
}

function getInviteStatus(invite: Invite): InviteStatus {
  if (invite.revoked_at) return 'revoked';
  if (new Date(invite.expires_at).getTime() <= Date.now()) return 'expired';
  if (invite.max_uses !== 0 && invite.used_count >= invite.max_uses) return 'exhausted';
  return 'valid';
}

function getStatusLabel(status: InviteStatus) {
  switch (status) {
    case 'valid':
      return '유효';
    case 'expired':
      return '만료됨';
    case 'exhausted':
      return '소진됨';
    case 'revoked':
      return '취소됨';
  }
}

function getInviteErrorMessage(error: unknown) {
  const message = error instanceof Error ? error.message : String((error as { message?: unknown })?.message ?? error);

  if (message.includes('INVITE_OWNER_FORBIDDEN')) {
    return '소유자 역할은 초대로 부여할 수 없습니다.';
  }
  if (message.includes('FORBIDDEN')) {
    return '초대는 앨범 소유자 또는 관리자만 만들 수 있습니다.';
  }
  return message || '초대 코드를 생성하지 못했습니다.';
}

export default function InviteScreen() {
  const { spaceId } = useLocalSearchParams<{ spaceId: string }>();
  const { user, isLoading: authLoading } = useAuth();
  const [role, setRole] = useState<InviteRole>('member');
  const [expiryDays, setExpiryDays] = useState(7);
  const [maxUses, setMaxUses] = useState(1);
  const [createdInvite, setCreatedInvite] = useState<GeneratedInvite | null>(null);
  const [invites, setInvites] = useState<Invite[]>([]);
  const [canManage, setCanManage] = useState<boolean | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [isGenerating, setIsGenerating] = useState(false);
  const [revokingId, setRevokingId] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  const fetchInvites = useCallback(async () => {
    if (!spaceId) return;
    const { data, error } = await supabase
      .from('invites')
      .select(INVITE_COLUMNS)
      .eq('space_id', spaceId)
      .order('created_at', { ascending: false });

    if (error) throw error;
    setInvites((data ?? []) as Invite[]);
  }, [spaceId]);

  const fetchAccessAndInvites = useCallback(async () => {
    if (!spaceId || !user) {
      setCanManage(false);
      setIsLoading(false);
      return;
    }

    setIsLoading(true);
    setLoadError(null);
    try {
      const { data, error } = await (supabase.from('space_members') as any)
        .select('role')
        .eq('space_id', spaceId)
        .eq('user_id', user.id)
        .maybeSingle();

      if (error) throw error;
      const allowed = data?.role === 'owner' || data?.role === 'admin';
      setCanManage(allowed);
      if (allowed) {
        await fetchInvites();
      } else {
        setInvites([]);
      }
    } catch (error) {
      setCanManage(false);
      setLoadError(error instanceof Error ? error.message : '초대 관리 권한을 확인하지 못했습니다.');
    } finally {
      setIsLoading(false);
    }
  }, [fetchInvites, spaceId, user]);

  useEffect(() => {
    if (!authLoading) {
      void fetchAccessAndInvites();
    }
  }, [authLoading, fetchAccessAndInvites]);

  const handleCreateInvite = async () => {
    if (!spaceId || !user || !canManage) return;
    setIsGenerating(true);
    try {
      const expiresAt = new Date(Date.now() + expiryDays * 24 * 60 * 60 * 1000).toISOString();
      const { data, error } = await (supabase.rpc as any)('create_invite', {
        p_space_id: spaceId,
        p_role: role,
        p_expires_at: expiresAt,
        p_max_uses: maxUses,
      });

      if (error) throw error;
      const result = Array.isArray(data) ? data[0] : data;
      if (!result?.token) {
        throw new Error('초대 코드를 발급받지 못했습니다.');
      }

      const createdAt = new Date().toISOString();
      const resolvedExpiresAt = result.expires_at || expiresAt;
      setCreatedInvite({
        id: result.invite_id,
        token: result.token,
        expiresAt: resolvedExpiresAt,
        role,
        maxUses,
      });
      setInvites((current) => [
        {
          id: result.invite_id,
          space_id: spaceId,
          role,
          created_by: user.id,
          expires_at: resolvedExpiresAt,
          max_uses: maxUses,
          used_count: 0,
          revoked_at: null,
          created_at: createdAt,
        },
        ...current.filter((invite) => invite.id !== result.invite_id),
      ]);
      Alert.alert('초대 코드 생성 완료', '이 코드는 지금 한 번만 볼 수 있습니다. 바로 복사하거나 공유해 주세요.');
    } catch (error) {
      Alert.alert('초대 생성 실패', getInviteErrorMessage(error));
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
        message: `[가족 앨범] 초대 코드입니다.\n\n초대 코드: ${createdInvite.token}\n역할: ${getRoleLabel(createdInvite.role)}\n사용 가능: ${createdInvite.maxUses}회\n만료: ${new Date(createdInvite.expiresAt).toLocaleString('ko-KR')}\n\n가족 앨범 앱에서 '코드로 참여'에 입력해 주세요.`,
      });
    } catch (error) {
      Alert.alert('공유 실패', error instanceof Error ? error.message : '초대 코드를 공유하지 못했습니다.');
    }
  };

  const revokeInvite = async (invite: Invite) => {
    if (!spaceId || !canManage) return;
    setRevokingId(invite.id);
    try {
      const revokedAt = new Date().toISOString();
      const { data, error } = await (supabase.from('invites') as any)
        .update({ revoked_at: revokedAt })
        .eq('id', invite.id)
        .eq('space_id', spaceId)
        .is('revoked_at', null)
        .select('id');

      if (error) throw error;
      if (!data?.length) {
        throw new Error('이미 취소되었거나 취소할 수 없는 초대입니다.');
      }

      setInvites((current) => current.map((item) => (
        item.id === invite.id ? { ...item, revoked_at: revokedAt } : item
      )));
      if (createdInvite?.id === invite.id) {
        setCreatedInvite(null);
      }
      Alert.alert('초대 취소 완료', '이 초대 코드는 더 이상 사용할 수 없습니다.');
    } catch (error) {
      Alert.alert('초대 취소 실패', error instanceof Error ? error.message : '초대를 취소하지 못했습니다.');
    } finally {
      setRevokingId(null);
    }
  };

  const confirmRevoke = (invite: Invite) => {
    Alert.alert(
      '초대 취소',
      '이 초대 코드를 즉시 사용할 수 없게 만들까요? 이미 참여한 멤버에게는 영향이 없습니다.',
      [
        { text: '아니요', style: 'cancel' },
        { text: '초대 취소', style: 'destructive', onPress: () => void revokeInvite(invite) },
      ]
    );
  };

  const handleRefreshInvites = async () => {
    setIsRefreshing(true);
    try {
      await fetchInvites();
    } catch (error) {
      Alert.alert('목록 새로고침 실패', error instanceof Error ? error.message : '초대 목록을 불러오지 못했습니다.');
    } finally {
      setIsRefreshing(false);
    }
  };

  const formattedTokenDisplay = createdInvite
    ? createdInvite.token.match(/.{1,8}/g)?.join(' ') ?? createdInvite.token
    : '';

  if (authLoading || isLoading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator size="large" color={colors.primary} />
      </View>
    );
  }

  if (!canManage) {
    return (
      <View style={styles.center}>
        <View style={styles.accessCard}>
          <Text style={typography.heading}>초대 관리 권한이 없어요</Text>
          <Text style={[typography.caption, styles.accessDescription]}>
            {loadError || '앨범 소유자와 관리자만 초대를 만들거나 취소할 수 있습니다.'}
          </Text>
        </View>
      </View>
    );
  }

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.contentContainer}>
      <Text style={typography.heading}>가족 초대하기</Text>
      <Text style={[typography.caption, styles.subtitle]}>
        역할과 유효 범위를 정해 초대 코드를 발급하세요. 소유자 역할은 초대로 부여할 수 없습니다.
      </Text>

      <View style={styles.card}>
        <Text style={styles.cardTitle}>역할</Text>
        {ROLE_OPTIONS.map((option) => {
          const selected = role === option.value;
          return (
            <TouchableOpacity
              key={option.value}
              style={[styles.roleOption, selected && styles.selectedOption]}
              onPress={() => setRole(option.value)}
              disabled={isGenerating}
              accessibilityRole="radio"
              accessibilityState={{ selected }}
            >
              <Text style={[styles.optionLabel, selected && styles.selectedOptionLabel]}>{option.label}</Text>
              <Text style={styles.optionDescription}>{option.description}</Text>
            </TouchableOpacity>
          );
        })}

        <Text style={[styles.cardTitle, styles.sectionTitle]}>만료 기간</Text>
        <View style={styles.optionRow}>
          {EXPIRY_OPTIONS.map((option) => {
            const selected = expiryDays === option.days;
            return (
              <TouchableOpacity
                key={option.days}
                style={[styles.compactOption, selected && styles.selectedOption]}
                onPress={() => setExpiryDays(option.days)}
                disabled={isGenerating}
                accessibilityRole="radio"
                accessibilityState={{ selected }}
              >
                <Text style={[styles.optionLabel, selected && styles.selectedOptionLabel]}>{option.label}</Text>
              </TouchableOpacity>
            );
          })}
        </View>

        <Text style={[styles.cardTitle, styles.sectionTitle]}>사용 횟수</Text>
        <View style={styles.optionRow}>
          {USE_OPTIONS.map((option) => {
            const selected = maxUses === option.count;
            return (
              <TouchableOpacity
                key={option.count}
                style={[styles.compactOption, selected && styles.selectedOption]}
                onPress={() => setMaxUses(option.count)}
                disabled={isGenerating}
                accessibilityRole="radio"
                accessibilityState={{ selected }}
              >
                <Text style={[styles.optionLabel, selected && styles.selectedOptionLabel]}>{option.label}</Text>
              </TouchableOpacity>
            );
          })}
        </View>

        <TouchableOpacity
          style={[styles.genBtn, isGenerating && styles.disabledBtn]}
          onPress={handleCreateInvite}
          disabled={isGenerating}
        >
          <Text style={styles.genBtnText}>{isGenerating ? '생성 중...' : '새 초대 코드 생성'}</Text>
        </TouchableOpacity>
      </View>

      {createdInvite && (
        <View style={[styles.card, styles.blockSpacing]}>
          <Text style={styles.cardTitle}>방금 만든 초대 코드</Text>
          <View style={styles.codeContainer}>
            <Text style={styles.codeText} selectable>
              {formattedTokenDisplay}
            </Text>
          </View>
          <Text style={styles.warningText}>
            ⚠️ 원문 코드는 보안상 지금 한 번만 표시됩니다. 닫은 뒤에는 다시 조회하거나 복사할 수 없습니다.
          </Text>
          <Text style={[typography.caption, styles.mtSm]}>
            {getRoleLabel(createdInvite.role)} · {createdInvite.maxUses}회 · {new Date(createdInvite.expiresAt).toLocaleString('ko-KR')} 만료
          </Text>
          <TouchableOpacity style={styles.copyBtn} onPress={handleCopyCode}>
            <Text style={styles.copyBtnText}>초대 코드 복사하기</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.shareBtn} onPress={handleShareCode}>
            <Text style={styles.shareBtnText}>메시지로 공유하기</Text>
          </TouchableOpacity>
        </View>
      )}

      <View style={[styles.card, styles.blockSpacing]}>
        <View style={styles.listHeader}>
          <Text style={styles.cardTitle}>발급한 초대</Text>
          <TouchableOpacity onPress={() => void handleRefreshInvites()} disabled={isRefreshing}>
            <Text style={styles.refreshText}>{isRefreshing ? '불러오는 중...' : '새로고침'}</Text>
          </TouchableOpacity>
        </View>
        <Text style={[typography.caption, styles.listNotice]}>
          보안상 목록에는 초대 코드 원문이 저장되지 않습니다. 다시 공유하려면 새 코드를 만들어 주세요.
        </Text>

        {invites.length === 0 ? (
          <Text style={styles.emptyText}>발급한 초대가 없습니다.</Text>
        ) : (
          invites.map((invite) => {
            const status = getInviteStatus(invite);
            const isRevoking = revokingId === invite.id;
            return (
              <View key={invite.id} style={styles.inviteRow}>
                <View style={styles.inviteRowHeader}>
                  <Text style={styles.inviteRole}>{getRoleLabel(invite.role)}</Text>
                  <View style={[styles.statusBadge, status === 'valid' ? styles.validBadge : styles.inactiveBadge]}>
                    <Text style={[styles.statusText, status === 'valid' ? styles.validText : styles.inactiveText]}>
                      {getStatusLabel(status)}
                    </Text>
                  </View>
                </View>
                <Text style={styles.inviteDetail}>
                  사용 {invite.used_count} / {invite.max_uses === 0 ? '무제한' : invite.max_uses}
                </Text>
                <Text style={styles.inviteDetail}>
                  만료 {new Date(invite.expires_at).toLocaleString('ko-KR')}
                </Text>
                {status === 'valid' && (
                  <TouchableOpacity
                    style={[styles.revokeBtn, isRevoking && styles.disabledBtn]}
                    onPress={() => confirmRevoke(invite)}
                    disabled={isRevoking || revokingId !== null}
                  >
                    <Text style={styles.revokeBtnText}>{isRevoking ? '취소 중...' : '초대 취소'}</Text>
                  </TouchableOpacity>
                )}
              </View>
            );
          })
        )}
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.bg,
  },
  contentContainer: {
    padding: spacing.md,
    paddingBottom: spacing.xl,
  },
  center: {
    flex: 1,
    backgroundColor: colors.bg,
    justifyContent: 'center',
    alignItems: 'center',
    padding: spacing.lg,
  },
  accessCard: {
    width: '100%',
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: radius.md,
    padding: spacing.lg,
    alignItems: 'center',
  },
  accessDescription: {
    marginTop: spacing.sm,
    textAlign: 'center',
  },
  subtitle: {
    marginTop: spacing.xs,
    marginBottom: spacing.lg,
    lineHeight: 18,
  },
  card: {
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: radius.md,
    padding: spacing.md,
  },
  blockSpacing: {
    marginTop: spacing.md,
  },
  cardTitle: {
    color: colors.text,
    fontSize: 16,
    fontWeight: '700',
    marginBottom: spacing.sm,
  },
  sectionTitle: {
    marginTop: spacing.md,
  },
  roleOption: {
    backgroundColor: colors.surfaceAlt,
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: radius.sm,
    padding: spacing.sm,
    marginTop: spacing.xs,
  },
  selectedOption: {
    borderColor: colors.primary,
    backgroundColor: 'rgba(56, 189, 248, 0.12)',
  },
  optionLabel: {
    color: colors.text,
    fontSize: 14,
    fontWeight: '600',
  },
  selectedOptionLabel: {
    color: colors.primary,
  },
  optionDescription: {
    color: colors.textMuted,
    fontSize: 12,
    lineHeight: 17,
    marginTop: 2,
  },
  optionRow: {
    flexDirection: 'row',
    gap: spacing.sm,
  },
  compactOption: {
    flex: 1,
    alignItems: 'center',
    backgroundColor: colors.surfaceAlt,
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: radius.sm,
    paddingVertical: spacing.sm,
  },
  genBtn: {
    backgroundColor: colors.primary,
    paddingVertical: spacing.md,
    borderRadius: radius.md,
    marginTop: spacing.lg,
    alignItems: 'center',
  },
  genBtnText: {
    color: colors.primaryText,
    fontWeight: '700',
    fontSize: 15,
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
    lineHeight: 17,
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
  listNotice: {
    lineHeight: 18,
    marginBottom: spacing.sm,
  },
  listHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  refreshText: {
    color: colors.primary,
    fontSize: 13,
    fontWeight: '600',
    marginBottom: spacing.sm,
  },
  emptyText: {
    color: colors.textMuted,
    textAlign: 'center',
    paddingVertical: spacing.lg,
  },
  inviteRow: {
    backgroundColor: colors.surfaceAlt,
    borderRadius: radius.sm,
    padding: spacing.md,
    marginTop: spacing.sm,
  },
  inviteRowHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: spacing.xs,
  },
  inviteRole: {
    color: colors.text,
    fontSize: 15,
    fontWeight: '700',
  },
  statusBadge: {
    borderRadius: radius.full,
    paddingHorizontal: spacing.sm,
    paddingVertical: 3,
  },
  validBadge: {
    backgroundColor: 'rgba(74, 222, 128, 0.14)',
  },
  inactiveBadge: {
    backgroundColor: 'rgba(148, 163, 184, 0.14)',
  },
  statusText: {
    fontSize: 12,
    fontWeight: '700',
  },
  validText: {
    color: colors.success,
  },
  inactiveText: {
    color: colors.textMuted,
  },
  inviteDetail: {
    color: colors.textMuted,
    fontSize: 12,
    lineHeight: 18,
  },
  revokeBtn: {
    alignSelf: 'flex-start',
    borderColor: colors.danger,
    borderWidth: 1,
    borderRadius: radius.sm,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    marginTop: spacing.sm,
  },
  revokeBtnText: {
    color: colors.danger,
    fontSize: 13,
    fontWeight: '600',
  },
  disabledBtn: {
    opacity: 0.55,
  },
});
