import React, { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  FlatList,
  KeyboardAvoidingView,
  Modal,
  Platform,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';

import { useAuth } from '@/auth';
import { supabase } from '@/lib/supabase';
import { colors, radius, spacing, typography } from '@/lib/theme';

const MAX_BODY_LENGTH = 1000;

interface CommentItem {
  id: string;
  body: string;
  created_at: string;
  author_id: string;
  author_name: string;
}

interface AssetCommentsModalProps {
  visible: boolean;
  spaceId: string;
  assetId: string;
  onClose: () => void;
  /** 개수가 바뀌면 상세 화면의 배지를 맞춰준다. */
  onCountChange: (assetId: string, count: number) => void;
}

function formatCommentTime(value: string): string {
  const created = new Date(value);
  const today = new Date();
  const isToday =
    created.getFullYear() === today.getFullYear() &&
    created.getMonth() === today.getMonth() &&
    created.getDate() === today.getDate();

  return isToday
    ? created.toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit' })
    : created.toLocaleDateString('ko-KR', { month: 'short', day: 'numeric' });
}

export function AssetCommentsModal({
  visible,
  spaceId,
  assetId,
  onClose,
  onCountChange,
}: AssetCommentsModalProps) {
  const { user } = useAuth();
  const userId = user?.id;

  const [comments, setComments] = useState<CommentItem[]>([]);
  const [draft, setDraft] = useState('');
  const [isLoading, setIsLoading] = useState(true);
  const [isPosting, setIsPosting] = useState(false);

  const fetchComments = useCallback(async () => {
    const { data, error } = await supabase
      .from('comments')
      .select('id, body, created_at, author_id, profiles(display_name)')
      .eq('asset_id', assetId)
      .is('deleted_at', null)
      .order('created_at', { ascending: true });

    if (error) throw error;

    const items: CommentItem[] = ((data as any[]) || []).map((row) => ({
      id: row.id,
      body: row.body,
      created_at: row.created_at,
      author_id: row.author_id,
      author_name: row.profiles?.display_name || row.author_id.slice(0, 8),
    }));

    setComments(items);
    onCountChange(assetId, items.length);
  }, [assetId, onCountChange]);

  useEffect(() => {
    if (!visible) return;

    let isCancelled = false;
    const load = async () => {
      setIsLoading(true);
      try {
        await fetchComments();
      } catch (error: any) {
        if (!isCancelled) {
          Alert.alert('댓글을 불러오지 못했어요', error?.message || '잠시 후 다시 시도해 주세요.');
        }
      } finally {
        if (!isCancelled) setIsLoading(false);
      }
    };

    void load();
    return () => {
      isCancelled = true;
    };
  }, [visible, fetchComments]);

  const handlePost = async () => {
    const body = draft.trim();
    if (!body || !userId || isPosting) return;

    setIsPosting(true);
    try {
      const { error } = await (supabase.from('comments') as any).insert({
        space_id: spaceId,
        asset_id: assetId,
        author_id: userId,
        body,
      });
      if (error) throw error;

      setDraft('');
      await fetchComments();
    } catch (error: any) {
      Alert.alert('댓글을 남기지 못했어요', error?.message || '잠시 후 다시 시도해 주세요.');
    } finally {
      setIsPosting(false);
    }
  };

  const handleDelete = (comment: CommentItem) => {
    Alert.alert('댓글 삭제', '이 댓글을 지울까요?', [
      { text: '취소', style: 'cancel' },
      {
        text: '삭제',
        style: 'destructive',
        onPress: async () => {
          try {
            // 하드 삭제 대신 deleted_at을 채운다. comments_select가 이 값으로 걸러낸다.
            const { error } = await (supabase.from('comments') as any)
              .update({ deleted_at: new Date().toISOString() })
              .eq('id', comment.id);
            if (error) throw error;
            await fetchComments();
          } catch (error: any) {
            Alert.alert('삭제 실패', error?.message || '댓글을 지우지 못했습니다.');
          }
        },
      },
    ]);
  };

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <View style={styles.backdrop}>
        <TouchableOpacity style={styles.backdropTouchable} onPress={onClose} activeOpacity={1} />

        <KeyboardAvoidingView
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
          style={styles.sheet}
        >
          <View style={styles.handleBar} />
          <View style={styles.header}>
            <Text style={typography.heading}>댓글 {comments.length > 0 ? comments.length : ''}</Text>
            <TouchableOpacity onPress={onClose}>
              <Text style={styles.closeText}>닫기</Text>
            </TouchableOpacity>
          </View>

          {isLoading ? (
            <View style={styles.center}>
              <ActivityIndicator color={colors.primary} />
            </View>
          ) : (
            <FlatList
              data={comments}
              keyExtractor={(item) => item.id}
              contentContainerStyle={comments.length === 0 ? styles.emptyContainer : undefined}
              ListEmptyComponent={
                <Text style={typography.caption}>첫 댓글을 남겨 보세요</Text>
              }
              renderItem={({ item }) => (
                <View style={styles.commentRow}>
                  <View style={styles.commentBody}>
                    <View style={styles.commentMeta}>
                      <Text style={styles.authorName}>{item.author_name}</Text>
                      <Text style={typography.caption}>{formatCommentTime(item.created_at)}</Text>
                    </View>
                    <Text style={styles.commentText}>{item.body}</Text>
                  </View>
                  {item.author_id === userId && (
                    <TouchableOpacity onPress={() => handleDelete(item)} hitSlop={8}>
                      <Text style={styles.deleteText}>삭제</Text>
                    </TouchableOpacity>
                  )}
                </View>
              )}
            />
          )}

          <View style={styles.inputRow}>
            <TextInput
              style={styles.input}
              value={draft}
              onChangeText={setDraft}
              placeholder="댓글 남기기"
              placeholderTextColor={colors.textMuted}
              maxLength={MAX_BODY_LENGTH}
              multiline
            />
            <TouchableOpacity
              style={[styles.postBtn, (!draft.trim() || isPosting) && styles.disabledBtn]}
              onPress={handlePost}
              disabled={!draft.trim() || isPosting}
            >
              <Text style={styles.postBtnText}>{isPosting ? '...' : '등록'}</Text>
            </TouchableOpacity>
          </View>
        </KeyboardAvoidingView>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.6)',
    justifyContent: 'flex-end',
  },
  backdropTouchable: {
    flex: 1,
  },
  sheet: {
    maxHeight: '75%',
    minHeight: '45%',
    backgroundColor: colors.bg,
    borderTopLeftRadius: radius.lg,
    borderTopRightRadius: radius.lg,
    paddingBottom: spacing.md,
  },
  handleBar: {
    alignSelf: 'center',
    width: 40,
    height: 4,
    borderRadius: radius.full,
    backgroundColor: colors.border,
    marginTop: spacing.sm,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  closeText: {
    color: colors.primary,
    fontSize: 14,
    fontWeight: '600',
  },
  center: {
    paddingVertical: spacing.xl,
    alignItems: 'center',
  },
  emptyContainer: {
    paddingVertical: spacing.xl,
    alignItems: 'center',
  },
  commentRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.sm,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  commentBody: {
    flex: 1,
    gap: 2,
  },
  commentMeta: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  authorName: {
    color: colors.text,
    fontSize: 13,
    fontWeight: '700',
  },
  commentText: {
    color: colors.text,
    fontSize: 15,
    lineHeight: 21,
  },
  deleteText: {
    color: colors.textMuted,
    fontSize: 12,
  },
  inputRow: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: spacing.sm,
    paddingHorizontal: spacing.md,
    paddingTop: spacing.sm,
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
  input: {
    flex: 1,
    maxHeight: 100,
    color: colors.text,
    fontSize: 15,
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  postBtn: {
    backgroundColor: colors.primary,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: radius.md,
  },
  postBtnText: {
    color: colors.primaryText,
    fontSize: 14,
    fontWeight: '700',
  },
  disabledBtn: {
    opacity: 0.5,
  },
});
