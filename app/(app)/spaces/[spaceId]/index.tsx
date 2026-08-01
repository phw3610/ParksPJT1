import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import React, { useEffect, useState } from 'react';
import {
  Alert,
  Modal,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';

import { useAuth } from '@/auth';
import { FolderBrowser } from '@/components/FolderBrowser';
import type { MemberRole } from '@/lib/database.types';
import { supabase } from '@/lib/supabase';
import { colors, radius, spacing, typography } from '@/lib/theme';

export default function SpaceHomeScreen() {
  const { spaceId } = useLocalSearchParams<{ spaceId: string }>();
  const { user } = useAuth();
  const router = useRouter();

  const [spaceName, setSpaceName] = useState<string>('');
  const [role, setRole] = useState<MemberRole | null>(null);
  const [isOwner, setIsOwner] = useState(false);
  const [canManage, setCanManage] = useState(false);

  // Rename modal state
  const [showRenameModal, setShowRenameModal] = useState(false);
  const [newNameInput, setNewNameInput] = useState('');
  const [isUpdating, setIsUpdating] = useState(false);

  const fetchSpaceInfo = async () => {
    if (!spaceId || !user) return;
    try {
      // 1. Fetch space
      const { data: spaceData } = await (supabase.from('spaces') as any)
        .select('name, owner_id')
        .eq('id', spaceId)
        .is('deleted_at', null)
        .maybeSingle();

      if (spaceData) {
        setSpaceName(spaceData.name);
        setNewNameInput(spaceData.name);
        if (spaceData.owner_id === user.id) {
          setIsOwner(true);
        }
      }

      // 2. Fetch member role
      const { data: memberData } = await (supabase.from('space_members') as any)
        .select('role')
        .eq('space_id', spaceId)
        .eq('user_id', user.id)
        .maybeSingle();

      if (memberData) {
        setRole(memberData.role);
        const managed = memberData.role === 'owner' || memberData.role === 'admin';
        setCanManage(managed);
        if (memberData.role === 'owner') {
          setIsOwner(true);
        }
      }
    } catch {
      /* 무시 */
    }
  };

  useEffect(() => {
    fetchSpaceInfo();
  }, [spaceId, user]);

  const handleRenameSpace = async () => {
    const trimmed = newNameInput.trim();
    if (trimmed.length < 1 || trimmed.length > 50) {
      Alert.alert('알림', '앨범 이름은 1자 이상 50자 이하로 입력해 주세요.');
      return;
    }
    if (!spaceId) return;

    setIsUpdating(true);
    try {
      const { error } = await (supabase.from('spaces') as any)
        .update({ name: trimmed })
        .eq('id', spaceId);

      if (error) throw error;

      setSpaceName(trimmed);
      setShowRenameModal(false);
      Alert.alert('완료', '앨범 이름이 변경되었습니다.');
    } catch (e: any) {
      Alert.alert('수정 실패', e.message || '앨범 이름을 변경하지 못했습니다.');
    } finally {
      setIsUpdating(false);
    }
  };

  const handleDeleteSpace = async () => {
    if (!spaceId) return;

    Alert.alert(
      '앨범 삭제',
      `'${spaceName || '이 앨범'}'을 삭제하시겠습니까?\n\n※ 앱 내의 메타데이터만 삭제되며, Google 드라이브에 저장된 원본 사진 파일은 삭제되지 않고 안전하게 보관됩니다.`,
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
                .eq('id', spaceId);

              if (error) throw error;

              Alert.alert('삭제 완료', '앨범이 삭제되었습니다.');
              router.replace('/(app)/spaces');
            } catch (e: any) {
              Alert.alert('삭제 실패', e.message || '앨범을 삭제하지 못했습니다.');
            }
          },
        },
      ]
    );
  };

  const handleLeaveSpace = async () => {
    if (!spaceId || !user) return;

    Alert.alert(
      '앨범 나가기',
      `'${spaceName || '이 앨범'}'에서 나가시겠습니까?\n\n※ 앨범에서 나가더라도 본인이 올린 사진과 Google 드라이브의 원본 파일은 삭제되지 않고 안전하게 보관됩니다. 다시 참여하려면 가족에게 새로운 초대 코드를 받아야 합니다.`,
      [
        { text: '취소', style: 'cancel' },
        {
          text: '나가기',
          style: 'destructive',
          onPress: async () => {
            try {
              const { error } = await supabase
                .from('space_members')
                .delete()
                .eq('space_id', spaceId)
                .eq('user_id', user.id);

              if (error) throw error;

              Alert.alert('완료', '앨범에서 나갔습니다.');
              router.replace('/(app)/spaces');
            } catch (e: any) {
              Alert.alert('나가기 실패', e.message || '앨범에서 나가지 못했습니다.');
            }
          },
        },
      ]
    );
  };

  return (
    <View style={styles.container}>
      <Stack.Screen
        options={{
          title: spaceName || '앨범 홈',
          headerRight: () => (
            <View style={styles.headerRightRow}>
              {/* 소유자 전용: 저장소 설정 버튼 */}
              {isOwner && (
                <TouchableOpacity
                  style={styles.headerBtn}
                  onPress={() => router.push(`/(app)/spaces/${spaceId}/connect-storage`)}
                >
                  <Text style={styles.headerBtnText}>⚙️ 저장소</Text>
                </TouchableOpacity>
              )}

              {/* 관리자/소유자: 이름 변경 */}
              {canManage && (
                <TouchableOpacity
                  style={styles.headerBtn}
                  onPress={() => {
                    setNewNameInput(spaceName);
                    setShowRenameModal(true);
                  }}
                >
                  <Text style={styles.headerBtnText}>✏️ 이름</Text>
                </TouchableOpacity>
              )}

              {/* 소유자: 앨범 삭제 / 초대받은 멤버(비소유자): 앨범 나가기 */}
              {isOwner ? (
                <TouchableOpacity style={[styles.headerBtn, styles.dangerHeaderBtn]} onPress={handleDeleteSpace}>
                  <Text style={styles.dangerHeaderBtnText}>🗑️ 삭제</Text>
                </TouchableOpacity>
              ) : role ? (
                <TouchableOpacity style={[styles.headerBtn, styles.dangerHeaderBtn]} onPress={handleLeaveSpace}>
                  <Text style={styles.dangerHeaderBtnText}>🚪 나가기</Text>
                </TouchableOpacity>
              ) : null}
            </View>
          ),
        }}
      />

      <FolderBrowser spaceId={spaceId!} folderId={null} />

      {/* Rename Modal */}
      <Modal visible={showRenameModal} transparent animationType="fade">
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
              value={newNameInput}
              onChangeText={setNewNameInput}
              maxLength={50}
              autoFocus
            />

            <View style={styles.modalActions}>
              <TouchableOpacity
                style={styles.modalCancelBtn}
                onPress={() => setShowRenameModal(false)}
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
  headerRightRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  headerBtn: {
    backgroundColor: colors.surfaceAlt,
    paddingHorizontal: 7,
    paddingVertical: 4,
    borderRadius: radius.sm,
  },
  headerBtnText: {
    color: colors.text,
    fontSize: 12,
    fontWeight: '600',
  },
  dangerHeaderBtn: {
    backgroundColor: 'rgba(248, 113, 113, 0.2)',
  },
  dangerHeaderBtnText: {
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
