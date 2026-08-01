import { useRouter } from 'expo-router';
import React, { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Modal,
  RefreshControl,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';

import { useAuth } from '@/auth';
import type { Space } from '@/lib/database.types';
import { supabase } from '@/lib/supabase';
import { colors, radius, spacing, typography } from '@/lib/theme';

interface SpaceWithRole extends Space {
  role: string;
}

export function normalizeInviteToken(input: string): string {
  let token = input.trim();
  // 1. URL 형태 전체를 붙여넣은 경우 처리 (예: https://domain.com/invite/abcdef...)
  if (token.includes('/')) {
    const parts = token.split('/').filter(Boolean);
    token = parts[parts.length - 1] || token;
  }
  // 2. 내부 공백, 줄바꿈, 탭, 하이픈 제거
  token = token.replace(/[\s\-]/g, '');
  return token;
}

export default function SpaceListScreen() {
  const { user, signOut } = useAuth();
  const router = useRouter();
  const [spaces, setSpaces] = useState<SpaceWithRole[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);

  // Rename modal state
  const [editingSpace, setEditingSpace] = useState<SpaceWithRole | null>(null);
  const [renameInput, setRenameInput] = useState('');
  const [isUpdating, setIsUpdating] = useState(false);

  // Join by code modal state
  const [showJoinModal, setShowJoinModal] = useState(false);
  const [joinCodeInput, setJoinCodeInput] = useState('');
  const [isJoining, setIsJoining] = useState(false);

  const fetchSpaces = async () => {
    if (!user) return;
    try {
      const { data, error } = await supabase
        .from('space_members')
        .select('role, spaces(*)')
        .eq('user_id', user.id);

      if (error) throw error;

      const items: SpaceWithRole[] = (data || [])
        .map((row: any) => {
          if (!row.spaces || row.spaces.deleted_at) return null;
          return {
            ...row.spaces,
            role: row.role,
          };
        })
        .filter(Boolean);

      setSpaces(items);
    } catch {
      /* 에러 처리 */
    } finally {
      setIsLoading(false);
      setIsRefreshing(false);
    }
  };

  useEffect(() => {
    fetchSpaces();
  }, [user]);

  const onRefresh = () => {
    setIsRefreshing(true);
    fetchSpaces();
  };

  const handleRenameSpace = async () => {
    if (!editingSpace) return;
    const trimmed = renameInput.trim();
    if (trimmed.length < 1 || trimmed.length > 50) {
      Alert.alert('알림', '앨범 이름은 1자 이상 50자 이하로 입력해 주세요.');
      return;
    }

    setIsUpdating(true);
    try {
      const { error } = await (supabase.from('spaces') as any)
        .update({ name: trimmed })
        .eq('id', editingSpace.id);

      if (error) throw error;

      setEditingSpace(null);
      Alert.alert('완료', '앨범 이름이 변경되었습니다.');
      fetchSpaces();
    } catch (e: any) {
      Alert.alert('수정 실패', e.message || '앨범 이름을 변경하지 못했습니다.');
    } finally {
      setIsUpdating(false);
    }
  };

  const handleDeleteSpace = async (space: SpaceWithRole) => {
    Alert.alert(
      '앨범 삭제',
      `'${space.name}' 앨범을 삭제하시겠습니까?\n\n※ 앱 내의 메타데이터만 삭제되며, Google 드라이브에 저장된 원본 사진 파일은 삭제되지 않고 안전하게 보관됩니다.`,
      [
        { text: '취소', style: 'cancel' },
        {
          text: '삭제',
          style: 'destructive',
          onPress: async () => {
            try {
              const { error } = await supabase
                .from('spaces')
                .delete()
                .eq('id', space.id);

              if (error) throw error;

              Alert.alert('삭제 완료', '앨범이 삭제되었습니다.');
              fetchSpaces();
            } catch (e: any) {
              Alert.alert('삭제 실패', e.message || '앨범을 삭제하지 못했습니다.');
            }
          },
        },
      ]
    );
  };

  const handleJoinByCode = async () => {
    const normalizedToken = normalizeInviteToken(joinCodeInput);
    if (!normalizedToken) {
      Alert.alert('알림', '초대 코드를 입력해 주세요.');
      return;
    }

    setIsJoining(true);
    try {
      const { data: spaceId, error } = await (supabase.rpc as any)('accept_invite', {
        p_token: normalizedToken,
      });

      if (error) {
        if (error.message?.includes('INVITE_INVALID') || error.code === 'P0001') {
          throw new Error('만료됐거나, 이미 사용 횟수를 다 썼거나, 잘못된 초대 코드입니다.');
        } else if (error.message?.includes('AUTH_REQUIRED')) {
          throw new Error('로그인이 필요합니다.');
        } else {
          throw new Error(error.message || '초대를 수락하지 못했습니다.');
        }
      }

      if (!spaceId) {
        throw new Error('스페이스 정보를 불러올 수 없습니다.');
      }

      setShowJoinModal(false);
      setJoinCodeInput('');
      Alert.alert('참여 완료!', '가족 앨범에 성공적으로 참여했습니다.');
      fetchSpaces();
      router.push(`/(app)/spaces/${spaceId}`);
    } catch (e: any) {
      Alert.alert('참여 실패', e.message || '초대를 수락하지 못했습니다.');
    } finally {
      setIsJoining(false);
    }
  };

  const getRoleLabel = (role: string) => {
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

  return (
    <View style={styles.container}>
      <View style={styles.topBar}>
        <Text style={styles.userEmail}>{user?.email}</Text>
        <TouchableOpacity onPress={signOut} style={styles.logoutBtn}>
          <Text style={styles.logoutText}>로그아웃</Text>
        </TouchableOpacity>
      </View>

      {isLoading ? (
        <View style={styles.center}>
          <ActivityIndicator size="large" color={colors.primary} />
        </View>
      ) : spaces.length === 0 ? (
        <View style={styles.emptyContainer}>
          <Text style={[typography.heading, styles.emptyTitle]}>아직 앨범이 없어요</Text>
          <Text style={[typography.caption, styles.emptySub]}>
            가족 앨범을 만들거나 초대 코드로 참여해 보세요
          </Text>
          <View style={styles.btnRow}>
            <TouchableOpacity
              style={styles.createBtn}
              onPress={() => router.push('/(app)/spaces/create')}
            >
              <Text style={styles.createBtnText}>+ 새 가족 앨범 만들기</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.createBtn, styles.joinBtn]}
              onPress={() => setShowJoinModal(true)}
            >
              <Text style={styles.joinBtnText}>🔑 코드로 참여</Text>
            </TouchableOpacity>
          </View>
        </View>
      ) : (
        <FlatList
          data={spaces}
          keyExtractor={(item) => item.id}
          refreshControl={
            <RefreshControl refreshing={isRefreshing} onRefresh={onRefresh} tintColor={colors.primary} />
          }
          contentContainerStyle={styles.listContent}
          renderItem={({ item }) => {
            const isOwner = item.role === 'owner';
            const canManage = item.role === 'owner' || item.role === 'admin';

            return (
              <TouchableOpacity
                style={styles.spaceCard}
                onPress={() => router.push(`/(app)/spaces/${item.id}`)}
              >
                <View style={styles.cardHeader}>
                  <Text style={styles.spaceName}>{item.name}</Text>
                  <View style={styles.roleBadge}>
                    <Text style={styles.roleText}>{getRoleLabel(item.role)}</Text>
                  </View>
                </View>

                <View style={styles.cardFooter}>
                  <Text style={typography.caption}>
                    생성일: {new Date(item.created_at).toLocaleDateString('ko-KR')}
                  </Text>

                  <View style={styles.cardActions}>
                    {canManage && (
                      <TouchableOpacity
                        style={styles.actionBtn}
                        onPress={() => {
                          setEditingSpace(item);
                          setRenameInput(item.name);
                        }}
                      >
                        <Text style={styles.actionBtnText}>✏️ 이름 변경</Text>
                      </TouchableOpacity>
                    )}
                    {isOwner && (
                      <TouchableOpacity
                        style={[styles.actionBtn, styles.dangerBtn]}
                        onPress={() => handleDeleteSpace(item)}
                      >
                        <Text style={styles.dangerBtnText}>🗑️ 삭제</Text>
                      </TouchableOpacity>
                    )}
                  </View>
                </View>
              </TouchableOpacity>
            );
          }}
          ListFooterComponent={
            <View style={styles.footerBtnRow}>
              <TouchableOpacity
                style={styles.createBtn}
                onPress={() => router.push('/(app)/spaces/create')}
              >
                <Text style={styles.createBtnText}>+ 새 가족 앨범 만들기</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.createBtn, styles.joinBtn]}
                onPress={() => setShowJoinModal(true)}
              >
                <Text style={styles.joinBtnText}>🔑 코드로 참여</Text>
              </TouchableOpacity>
            </View>
          }
        />
      )}

      {/* Join by Code Modal */}
      <Modal visible={showJoinModal} transparent animationType="fade">
        <View style={styles.modalOverlay}>
          <View style={styles.modalCard}>
            <Text style={typography.heading}>🔑 초대 코드로 참여</Text>
            <Text style={[typography.caption, styles.modalSub]}>
              전달받은 64자리 초대 코드를 입력하거나 붙여넣으세요.
            </Text>

            <TextInput
              style={[styles.modalInput, styles.codeModalInput]}
              placeholder="초대 코드 또는 링크 붙여넣기"
              placeholderTextColor={colors.textMuted}
              value={joinCodeInput}
              onChangeText={setJoinCodeInput}
              autoCapitalize="none"
              autoCorrect={false}
              multiline
              numberOfLines={3}
              autoFocus
            />

            <View style={styles.modalActions}>
              <TouchableOpacity
                style={styles.modalCancelBtn}
                onPress={() => {
                  setShowJoinModal(false);
                  setJoinCodeInput('');
                }}
              >
                <Text style={styles.modalCancelText}>취소</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.modalConfirmBtn, isJoining && styles.disabledBtn]}
                onPress={handleJoinByCode}
                disabled={isJoining}
              >
                <Text style={styles.modalConfirmText}>
                  {isJoining ? '참여 중...' : '참여하기'}
                </Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      {/* Rename Modal */}
      <Modal visible={!!editingSpace} transparent animationType="fade">
        <View style={styles.modalOverlay}>
          <View style={styles.modalCard}>
            <Text style={typography.heading}>앨범 이름 변경</Text>
            <Text style={[typography.caption, styles.modalSub]}>
              1자 이상 50자 이하로 입력해 주세요.
            </Text>

            <TextInput
              style={styles.modalInput}
              placeholder="앨범 이름"
              placeholderTextColor={colors.textMuted}
              value={renameInput}
              onChangeText={setRenameInput}
              maxLength={50}
              autoFocus
            />

            <View style={styles.modalActions}>
              <TouchableOpacity
                style={styles.modalCancelBtn}
                onPress={() => setEditingSpace(null)}
              >
                <Text style={styles.modalCancelText}>취소</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.modalConfirmBtn, isUpdating && styles.disabledBtn]}
                onPress={handleRenameSpace}
                disabled={isUpdating}
              >
                <Text style={styles.modalConfirmText}>저장</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.bg,
  },
  topBar: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  userEmail: {
    color: colors.textMuted,
    fontSize: 13,
  },
  logoutBtn: {
    paddingVertical: 4,
    paddingHorizontal: 8,
  },
  logoutText: {
    color: colors.danger,
    fontSize: 13,
  },
  center: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  emptyContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: spacing.xl,
  },
  emptyTitle: {
    textAlign: 'center',
    marginBottom: spacing.xs,
  },
  emptySub: {
    textAlign: 'center',
    marginBottom: spacing.xl,
  },
  btnRow: {
    flexDirection: 'column',
    gap: spacing.sm,
    width: '100%',
    paddingHorizontal: spacing.md,
  },
  footerBtnRow: {
    marginTop: spacing.md,
    flexDirection: 'row',
    gap: spacing.sm,
  },
  createBtn: {
    flex: 1,
    backgroundColor: colors.primary,
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.md,
    borderRadius: radius.md,
    alignItems: 'center',
  },
  createBtnText: {
    color: colors.primaryText,
    fontWeight: '600',
    fontSize: 15,
  },
  joinBtn: {
    backgroundColor: colors.surfaceAlt,
    borderWidth: 1,
    borderColor: colors.border,
  },
  joinBtnText: {
    color: colors.text,
    fontWeight: '600',
    fontSize: 15,
  },
  listContent: {
    padding: spacing.md,
  },
  spaceCard: {
    backgroundColor: colors.surface,
    padding: spacing.md,
    borderRadius: radius.md,
    borderColor: colors.border,
    borderWidth: 1,
    marginBottom: spacing.md,
  },
  cardHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: spacing.xs,
  },
  spaceName: {
    fontSize: 18,
    fontWeight: '700',
    color: colors.text,
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
  cardFooter: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginTop: spacing.xs,
  },
  cardActions: {
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
    fontWeight: '600',
  },
  dangerBtn: {
    backgroundColor: 'rgba(248, 113, 113, 0.2)',
  },
  dangerBtnText: {
    color: colors.danger,
    fontSize: 12,
    fontWeight: '600',
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.6)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: spacing.lg,
  },
  modalCard: {
    width: '100%',
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: radius.md,
    padding: spacing.lg,
  },
  modalSub: {
    marginTop: spacing.xs,
  },
  modalInput: {
    backgroundColor: colors.surfaceAlt,
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: radius.sm,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    color: colors.text,
    marginTop: spacing.md,
    marginBottom: spacing.lg,
  },
  codeModalInput: {
    minHeight: 70,
    textAlignVertical: 'top',
    fontSize: 13,
  },
  modalActions: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    gap: spacing.sm,
  },
  modalCancelBtn: {
    paddingHorizontal: 16,
    paddingVertical: 10,
  },
  modalCancelText: {
    color: colors.textMuted,
  },
  modalConfirmBtn: {
    backgroundColor: colors.primary,
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: radius.sm,
  },
  modalConfirmText: {
    color: colors.primaryText,
    fontWeight: '600',
  },
  disabledBtn: {
    opacity: 0.6,
  },
});
