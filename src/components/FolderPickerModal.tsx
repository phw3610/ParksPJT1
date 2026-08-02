import React, { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Modal,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';

import type { Folder } from '@/lib/database.types';
import { supabase } from '@/lib/supabase';
import { colors, radius, spacing, typography } from '@/lib/theme';

type PickerFolder = Pick<Folder, 'id' | 'name' | 'path' | 'depth'>;

interface FolderPickerModalProps {
  visible: boolean;
  spaceId: string;
  currentFolderId?: string | null;
  busy?: boolean;
  onClose: () => void;
  onSelect: (folderId: string | null, folderName: string) => void;
}

export function FolderPickerModal({
  visible,
  spaceId,
  currentFolderId = null,
  busy = false,
  onClose,
  onSelect,
}: FolderPickerModalProps) {
  const [folders, setFolders] = useState<PickerFolder[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const loadFolders = useCallback(async () => {
    setIsLoading(true);
    setErrorMessage(null);

    const { data, error } = await supabase
      .from('folders')
      .select('id,name,path,depth')
      .eq('space_id', spaceId)
      .is('deleted_at', null)
      .order('path', { ascending: true });

    if (error) {
      setFolders([]);
      setErrorMessage(error.message || '폴더 목록을 불러오지 못했습니다.');
    } else {
      setFolders(data || []);
    }
    setIsLoading(false);
  }, [spaceId]);

  useEffect(() => {
    if (visible) void loadFolders();
  }, [loadFolders, visible]);

  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      onRequestClose={() => {
        if (!busy) onClose();
      }}
    >
      <View style={styles.overlay}>
        <View style={styles.card}>
          <Text style={typography.heading}>이동할 폴더 선택</Text>
          <Text style={[typography.caption, styles.subtitle]}>
            앨범 최상위 또는 원하는 폴더를 선택해 주세요.
          </Text>

          <TouchableOpacity
            style={[styles.folderRow, currentFolderId === null && styles.currentRow]}
            onPress={() => onSelect(null, '앨범 최상위')}
            disabled={busy}
            accessibilityRole="button"
            accessibilityLabel="앨범 최상위로 이동"
          >
            <Text style={styles.folderIcon}>🏠</Text>
            <View style={styles.folderTextWrap}>
              <Text style={styles.folderName}>앨범 최상위</Text>
            </View>
            {currentFolderId === null && <Text style={styles.currentText}>현재</Text>}
          </TouchableOpacity>

          <View style={styles.divider} />

          {isLoading ? (
            <View style={styles.center}>
              <ActivityIndicator color={colors.primary} />
            </View>
          ) : errorMessage ? (
            <View style={styles.center}>
              <Text style={styles.errorText}>{errorMessage}</Text>
              <TouchableOpacity style={styles.retryButton} onPress={() => void loadFolders()}>
                <Text style={styles.retryText}>다시 시도</Text>
              </TouchableOpacity>
            </View>
          ) : (
            <FlatList
              data={folders}
              keyExtractor={(folder) => folder.id}
              style={styles.list}
              contentContainerStyle={folders.length === 0 && styles.emptyList}
              ListEmptyComponent={<Text style={styles.emptyText}>만든 폴더가 없습니다.</Text>}
              renderItem={({ item }) => {
                const isCurrent = currentFolderId === item.id;
                return (
                  <TouchableOpacity
                    style={[
                      styles.folderRow,
                      isCurrent && styles.currentRow,
                      { paddingLeft: spacing.sm + Math.min(item.depth, 6) * 16 },
                    ]}
                    onPress={() => onSelect(item.id, item.name)}
                    disabled={busy}
                    accessibilityRole="button"
                    accessibilityLabel={`${item.path} 폴더로 이동`}
                  >
                    <Text style={styles.folderIcon}>{item.depth > 0 ? '↳' : '📁'}</Text>
                    <View style={styles.folderTextWrap}>
                      <Text style={styles.folderName} numberOfLines={1}>
                        {item.name}
                      </Text>
                      <Text style={styles.folderPath} numberOfLines={1}>
                        {item.path}
                      </Text>
                    </View>
                    {isCurrent && <Text style={styles.currentText}>현재</Text>}
                  </TouchableOpacity>
                );
              }}
            />
          )}

          <View style={styles.actions}>
            <TouchableOpacity
              style={[styles.closeButton, busy && styles.disabled]}
              onPress={onClose}
              disabled={busy}
            >
              <Text style={styles.closeText}>{busy ? '이동 중...' : '취소'}</Text>
            </TouchableOpacity>
          </View>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.6)',
    justifyContent: 'center',
    padding: spacing.lg,
  },
  card: {
    width: '100%',
    maxHeight: '80%',
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: radius.md,
    padding: spacing.lg,
  },
  subtitle: {
    marginTop: spacing.xs,
    marginBottom: spacing.md,
  },
  list: {
    flexGrow: 0,
  },
  folderRow: {
    minHeight: 54,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
    borderRadius: radius.sm,
  },
  currentRow: {
    backgroundColor: colors.surfaceAlt,
  },
  folderIcon: {
    width: 24,
    color: colors.textMuted,
    textAlign: 'center',
    fontSize: 16,
  },
  folderTextWrap: {
    flex: 1,
    minWidth: 0,
  },
  folderName: {
    color: colors.text,
    fontSize: 14,
    fontWeight: '600',
  },
  folderPath: {
    marginTop: 2,
    color: colors.textMuted,
    fontSize: 11,
  },
  currentText: {
    color: colors.primary,
    fontSize: 11,
    fontWeight: '600',
  },
  divider: {
    height: 1,
    backgroundColor: colors.border,
    marginBottom: spacing.xs,
  },
  center: {
    minHeight: 140,
    justifyContent: 'center',
    alignItems: 'center',
    padding: spacing.md,
  },
  errorText: {
    color: colors.danger,
    fontSize: 13,
    textAlign: 'center',
  },
  retryButton: {
    marginTop: spacing.sm,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
    borderRadius: radius.sm,
    backgroundColor: colors.surfaceAlt,
  },
  retryText: {
    color: colors.primary,
    fontWeight: '600',
  },
  emptyList: {
    minHeight: 100,
    justifyContent: 'center',
    alignItems: 'center',
  },
  emptyText: {
    color: colors.textMuted,
    fontSize: 13,
  },
  actions: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    marginTop: spacing.md,
  },
  closeButton: {
    paddingHorizontal: 16,
    paddingVertical: 10,
  },
  closeText: {
    color: colors.textMuted,
    fontWeight: '600',
  },
  disabled: {
    opacity: 0.6,
  },
});
