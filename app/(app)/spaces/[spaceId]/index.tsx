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
import { FavoritesView } from '@/components/FavoritesView';
import { FolderBrowser } from '@/components/FolderBrowser';
import { TimelineView } from '@/components/TimelineView';
import { supabase } from '@/lib/supabase';
import { colors, radius, spacing, typography } from '@/lib/theme';

export default function SpaceHomeScreen() {
  const { spaceId } = useLocalSearchParams<{ spaceId: string }>();
  const { user } = useAuth();
  const router = useRouter();

  const [spaceName, setSpaceName] = useState<string>('');
  const [isOwner, setIsOwner] = useState(false);
  const [canManage, setCanManage] = useState(false);
  const [viewMode, setViewMode] = useState<'folder' | 'timeline' | 'favorites'>('folder');

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

  // 앨범을 열면 확인한 것으로 본다. 목록의 미확인 배지는 이 시각을 기준으로 계산된다.
  useEffect(() => {
    if (!spaceId || !user) return;

    const markAsRead = async () => {
      try {
        const { error } = await (supabase.from('space_read_state') as any).upsert(
          {
            space_id: spaceId,
            user_id: user.id,
            last_read_at: new Date().toISOString(),
          },
          { onConflict: 'space_id,user_id' },
        );
        if (error) throw error;
      } catch (error) {
        // 0006 마이그레이션 적용 전에는 테이블이 없다. 앨범을 여는 것 자체를 막지는 않는다.
        console.warn('[space-home] 읽음 표시를 저장하지 못했습니다.', error);
      }
    };

    void markAsRead();
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

              {/* 소유자 전용: 앨범 삭제. 비소유자의 앨범 나가기는 멤버 화면에만 둔다. */}
              {isOwner && (
                <TouchableOpacity style={[styles.headerBtn, styles.dangerHeaderBtn]} onPress={handleDeleteSpace}>
                  <Text style={styles.dangerHeaderBtnText}>🗑️ 삭제</Text>
                </TouchableOpacity>
              )}
            </View>
          ),
        }}
      />

      <View style={styles.viewToggleBar}>
        <TouchableOpacity
          style={[styles.toggleBtn, viewMode === 'folder' && styles.toggleBtnActive]}
          onPress={() => setViewMode('folder')}
          activeOpacity={0.8}
        >
          <Text style={[styles.toggleText, viewMode === 'folder' && styles.toggleTextActive]}>
            📁 폴더
          </Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.toggleBtn, viewMode === 'timeline' && styles.toggleBtnActive]}
          onPress={() => setViewMode('timeline')}
          activeOpacity={0.8}
        >
          <Text style={[styles.toggleText, viewMode === 'timeline' && styles.toggleTextActive]}>
            📅 타임라인
          </Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.toggleBtn, viewMode === 'favorites' && styles.toggleBtnActive]}
          onPress={() => setViewMode('favorites')}
          activeOpacity={0.8}
        >
          <Text style={[styles.toggleText, viewMode === 'favorites' && styles.toggleTextActive]}>
            ⭐ 즐겨찾기
          </Text>
        </TouchableOpacity>
      </View>

      {viewMode === 'folder' ? (
        <FolderBrowser spaceId={spaceId!} folderId={null} />
      ) : viewMode === 'timeline' ? (
        <TimelineView spaceId={spaceId!} />
      ) : (
        <FavoritesView spaceId={spaceId!} />
      )}

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
  viewToggleBar: {
    flexDirection: 'row',
    backgroundColor: colors.surface,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
    gap: spacing.sm,
  },
  toggleBtn: {
    flex: 1,
    paddingVertical: spacing.xs,
    alignItems: 'center',
    borderRadius: radius.sm,
    backgroundColor: colors.surfaceAlt,
  },
  toggleBtnActive: {
    backgroundColor: colors.primary,
  },
  toggleText: {
    color: colors.textMuted,
    fontSize: 13,
    fontWeight: '600',
  },
  toggleTextActive: {
    color: colors.primaryText,
    fontWeight: '700',
  },
});
