import { useLocalSearchParams, useRouter } from 'expo-router';
import React, { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  FlatList,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';

import { useAuth } from '@/auth';
import type { MemberRole } from '@/lib/database.types';
import { supabase } from '@/lib/supabase';
import { colors, radius, spacing, typography } from '@/lib/theme';

interface MemberItem {
  user_id: string;
  role: MemberRole;
  joined_at: string;
  display_name: string;
}

export default function MembersScreen() {
  const { spaceId } = useLocalSearchParams<{ spaceId: string }>();
  const { user } = useAuth();
  const router = useRouter();

  const [members, setMembers] = useState<MemberItem[]>([]);
  const [currentUserRole, setCurrentUserRole] = useState<MemberRole | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  const fetchMembers = async () => {
    if (!spaceId || !user) return;
    try {
      const { data: memberData, error } = await supabase
        .from('space_members')
        .select('user_id, role, joined_at, profiles(display_name)')
        .eq('space_id', spaceId);

      if (error) throw error;

      const items: MemberItem[] = (memberData || []).map((row: any) => ({
        user_id: row.user_id,
        role: row.role,
        joined_at: row.joined_at,
        display_name: row.profiles?.display_name || row.user_id.slice(0, 8),
      }));

      const me = items.find((m) => m.user_id === user.id);
      if (me) setCurrentUserRole(me.role);

      setMembers(items);
    } catch {
      /* 무시 */
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    fetchMembers();
  }, [spaceId, user]);

  const handleChangeRole = async (targetUserId: string, newRole: MemberRole) => {
    if (!spaceId) return;
    try {
      const { error } = await (supabase.from('space_members') as any)
        .update({ role: newRole })
        .eq('space_id', spaceId)
        .eq('user_id', targetUserId);

      if (error) throw error;
      Alert.alert('역할 변경', '멤버 역할이 변경되었습니다.');
      fetchMembers();
    } catch (e: any) {
      Alert.alert('변경 실패', e.message);
    }
  };

  const handleKickMember = async (targetUserId: string, targetName: string) => {
    if (!spaceId) return;
    Alert.alert('멤버 강퇴', `'${targetName}' 님을 앨범에서 강퇴하시겠습니까?`, [
      { text: '취소', style: 'cancel' },
      {
        text: '강퇴',
        style: 'destructive',
        onPress: async () => {
          try {
            const { error } = await supabase
              .from('space_members')
              .delete()
              .eq('space_id', spaceId)
              .eq('user_id', targetUserId);

            if (error) throw error;
            Alert.alert('강퇴 완료', '멤버가 강퇴되었습니다.');
            fetchMembers();
          } catch (e: any) {
            Alert.alert('강퇴 실패', e.message);
          }
        },
      },
    ]);
  };

  const getRoleLabel = (role: MemberRole) => {
    switch (role) {
      case 'owner':
        return '소유자';
      case 'admin':
        return '관리자';
      case 'member':
        return '멤버';
      case 'viewer':
        return '보기 전용';
      default:
        return role;
    }
  };

  const isCanManage = currentUserRole === 'owner' || currentUserRole === 'admin';

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <Text style={typography.heading}>앨범 멤버 ({members.length})</Text>
        {isCanManage && (
          <TouchableOpacity
            style={styles.inviteBtn}
            onPress={() => router.push(`/(app)/spaces/${spaceId}/invite`)}
          >
            <Text style={styles.inviteBtnText}>+ 가족 초대</Text>
          </TouchableOpacity>
        )}
      </View>

      {isLoading ? (
        <View style={styles.center}>
          <ActivityIndicator size="large" color={colors.primary} />
        </View>
      ) : (
        <FlatList
          data={members}
          keyExtractor={(item) => item.user_id}
          contentContainerStyle={styles.listContent}
          renderItem={({ item }) => {
            const isSelf = item.user_id === user?.id;
            const isOwner = item.role === 'owner';

            return (
              <View style={styles.memberCard}>
                <View style={styles.memberInfo}>
                  <Text style={styles.memberName}>
                    {item.display_name} {isSelf && '(나)'}
                  </Text>
                  <View style={styles.roleBadge}>
                    <Text style={styles.roleText}>{getRoleLabel(item.role)}</Text>
                  </View>
                </View>

                {isCanManage && !isOwner && !isSelf && (
                  <View style={styles.actions}>
                    <TouchableOpacity
                      style={styles.actionBtn}
                      onPress={() =>
                        Alert.alert('역할 변경', '변경할 역할을 선택하세요.', [
                          { text: '관리자', onPress: () => handleChangeRole(item.user_id, 'admin') },
                          { text: '일반 멤버', onPress: () => handleChangeRole(item.user_id, 'member') },
                          { text: '보기 전용', onPress: () => handleChangeRole(item.user_id, 'viewer') },
                          { text: '취소', style: 'cancel' },
                        ])
                      }
                    >
                      <Text style={styles.actionBtnText}>역할 변경</Text>
                    </TouchableOpacity>

                    <TouchableOpacity
                      style={[styles.actionBtn, styles.kickBtn]}
                      onPress={() => handleKickMember(item.user_id, item.display_name)}
                    >
                      <Text style={styles.kickBtnText}>강퇴</Text>
                    </TouchableOpacity>
                  </View>
                )}
              </View>
            );
          }}
        />
      )}
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
    justifyContent: 'center',
    alignItems: 'center',
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  inviteBtn: {
    backgroundColor: colors.primary,
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: radius.sm,
  },
  inviteBtnText: {
    color: colors.primaryText,
    fontWeight: '600',
    fontSize: 13,
  },
  listContent: {
    padding: spacing.md,
    gap: spacing.sm,
  },
  memberCard: {
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: radius.md,
    padding: spacing.md,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  memberInfo: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  memberName: {
    color: colors.text,
    fontSize: 15,
    fontWeight: '600',
  },
  roleBadge: {
    backgroundColor: colors.surfaceAlt,
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: radius.sm,
  },
  roleText: {
    color: colors.primary,
    fontSize: 12,
    fontWeight: '600',
  },
  actions: {
    flexDirection: 'row',
    gap: spacing.xs,
  },
  actionBtn: {
    backgroundColor: colors.surfaceAlt,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: radius.sm,
  },
  actionBtnText: {
    color: colors.text,
    fontSize: 12,
  },
  kickBtn: {
    backgroundColor: 'rgba(248, 113, 113, 0.2)',
  },
  kickBtnText: {
    color: colors.danger,
    fontSize: 12,
    fontWeight: '600',
  },
});
