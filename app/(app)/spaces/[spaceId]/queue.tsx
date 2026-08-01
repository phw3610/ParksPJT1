import { useLocalSearchParams } from 'expo-router';
import React, { useEffect, useState } from 'react';
import {
  FlatList,
  StyleSheet,
  Switch,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';

import { colors, radius, spacing, typography } from '@/lib/theme';
import { queueManager, UploadQueueItem } from '@/queue';

export default function QueueScreen() {
  const { spaceId } = useLocalSearchParams<{ spaceId: string }>();
  const [items, setItems] = useState<UploadQueueItem[]>([]);
  const [wifiOnly, setWifiOnly] = useState(true);

  useEffect(() => {
    if (!spaceId) return;
    queueManager.init().then(() => {
      const unsub = queueManager.subscribe((newItems) => {
        setItems(newItems);
      });
      return unsub;
    });
  }, [spaceId]);

  const activeCount = items.filter((i) => i.status === 'uploading').length;
  const pendingCount = items.filter((i) => i.status === 'pending').length;
  const failedCount = items.filter((i) => i.status === 'failed' || i.status === 'paused').length;

  const handleRetry = (id: string) => {
    if (spaceId) queueManager.retryItem(id, spaceId);
  };

  const handleRemove = (id: string) => {
    if (spaceId) queueManager.removeItem(id, spaceId);
  };

  const handleClearCompleted = () => {
    if (spaceId) queueManager.clearCompleted(spaceId);
  };

  return (
    <View style={styles.container}>
      {/* 1. Queue Summary Header */}
      <View style={styles.summaryBar}>
        <Text style={styles.summaryText}>
          진행 중: {activeCount} | 대기: {pendingCount} | 실패: {failedCount}
        </Text>
        <TouchableOpacity style={styles.clearBtn} onPress={handleClearCompleted}>
          <Text style={styles.clearText}>완료 항목 정리</Text>
        </TouchableOpacity>
      </View>

      {/* 2. Wi-Fi Only Setting Toggle */}
      <View style={styles.settingRow}>
        <Text style={styles.settingLabel}>Wi-Fi에서만 업로드</Text>
        <Switch
          value={wifiOnly}
          onValueChange={setWifiOnly}
          trackColor={{ false: colors.border, true: colors.primary }}
          thumbColor={colors.text}
        />
      </View>

      {/* 3. Items List */}
      {items.length === 0 ? (
        <View style={styles.emptyContainer}>
          <Text style={typography.heading}>대기 중인 업로드가 없습니다.</Text>
        </View>
      ) : (
        <FlatList
          data={items}
          keyExtractor={(item) => item.id}
          contentContainerStyle={styles.listContent}
          renderItem={({ item }) => {
            const percent =
              item.byte_size > 0
                ? Math.min(Math.round((item.bytes_sent / item.byte_size) * 100), 100)
                : 0;

            return (
              <View style={styles.itemCard}>
                <View style={styles.itemRow}>
                  <Text style={styles.fileName} numberOfLines={1}>
                    {item.original_name}
                  </Text>
                  <Text
                    style={[
                      styles.statusBadge,
                      item.status === 'done' && styles.statusDone,
                      item.status === 'failed' && styles.statusFailed,
                      item.status === 'paused' && styles.statusPaused,
                    ]}
                  >
                    {item.status === 'uploading'
                      ? `${percent}%`
                      : item.status === 'done'
                      ? '완료'
                      : item.status === 'failed'
                      ? '실패'
                      : item.status === 'paused'
                      ? '일시정지'
                      : '대기 중'}
                  </Text>
                </View>

                {/* Progress Bar for uploading items */}
                {item.status === 'uploading' && (
                  <View style={styles.progressTrack}>
                    <View style={[styles.progressBar, { width: `${percent}%` }]} />
                  </View>
                )}

                {item.last_error && (
                  <Text style={styles.errorText}>⚠️ {item.last_error}</Text>
                )}

                <View style={styles.actionRow}>
                  {(item.status === 'failed' || item.status === 'paused') && (
                    <TouchableOpacity
                      style={styles.retryBtn}
                      onPress={() => handleRetry(item.id)}
                    >
                      <Text style={styles.retryText}>재시도</Text>
                    </TouchableOpacity>
                  )}
                  <TouchableOpacity
                    style={styles.deleteBtn}
                    onPress={() => handleRemove(item.id)}
                  >
                    <Text style={styles.deleteText}>삭제</Text>
                  </TouchableOpacity>
                </View>
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
  summaryBar: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: spacing.md,
    backgroundColor: colors.surface,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  summaryText: {
    color: colors.text,
    fontSize: 14,
    fontWeight: '600',
  },
  clearBtn: {
    paddingVertical: 4,
    paddingHorizontal: 8,
  },
  clearText: {
    color: colors.primary,
    fontSize: 12,
  },
  settingRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    backgroundColor: colors.surfaceAlt,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  settingLabel: {
    color: colors.text,
    fontSize: 14,
  },
  emptyContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: spacing.xl,
  },
  listContent: {
    padding: spacing.md,
    gap: spacing.sm,
  },
  itemCard: {
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: radius.md,
    padding: spacing.md,
  },
  itemRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: spacing.xs,
  },
  fileName: {
    color: colors.text,
    fontSize: 14,
    fontWeight: '600',
    flex: 1,
    marginRight: spacing.sm,
  },
  statusBadge: {
    color: colors.primary,
    fontSize: 12,
    fontWeight: '600',
  },
  statusDone: {
    color: colors.success,
  },
  statusFailed: {
    color: colors.danger,
  },
  statusPaused: {
    color: colors.warning,
  },
  progressTrack: {
    height: 4,
    backgroundColor: colors.surfaceAlt,
    borderRadius: 2,
    marginVertical: spacing.xs,
    overflow: 'hidden',
  },
  progressBar: {
    height: '100%',
    backgroundColor: colors.primary,
  },
  errorText: {
    color: colors.danger,
    fontSize: 12,
    marginTop: spacing.xs,
  },
  actionRow: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    gap: spacing.sm,
    marginTop: spacing.xs,
  },
  retryBtn: {
    backgroundColor: colors.primary,
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: radius.sm,
  },
  retryText: {
    color: colors.primaryText,
    fontSize: 12,
    fontWeight: '600',
  },
  deleteBtn: {
    paddingHorizontal: 10,
    paddingVertical: 4,
  },
  deleteText: {
    color: colors.textMuted,
    fontSize: 12,
  },
});
