import React from 'react';
import { StyleSheet, Text, View, type StyleProp, type ViewStyle } from 'react-native';

import { colors, radius } from '@/lib/theme';

/** 재생 시간을 m:ss(1시간 이상이면 h:mm:ss)로 표기한다. */
export function formatDuration(durationMs: number | null | undefined): string | null {
  if (!durationMs || durationMs <= 0) return null;

  const totalSeconds = Math.round(durationMs / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;

  if (hours > 0) {
    return `${hours}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
  }
  return `${minutes}:${String(seconds).padStart(2, '0')}`;
}

interface VideoBadgeProps {
  durationMs: number | null | undefined;
  style?: StyleProp<ViewStyle>;
}

/** 그리드 셀에서 영상임을 알리는 배지. 썸네일만으로는 사진과 구분되지 않는다. */
export function VideoBadge({ durationMs, style }: VideoBadgeProps) {
  const duration = formatDuration(durationMs);

  return (
    <View style={[styles.badge, style]} pointerEvents="none">
      <Text style={styles.text}>▶{duration ? ` ${duration}` : ''}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  badge: {
    position: 'absolute',
    top: 4,
    right: 4,
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: radius.sm,
    backgroundColor: 'rgba(0, 0, 0, 0.65)',
  },
  text: {
    color: colors.text,
    fontSize: 11,
    fontWeight: '600',
  },
});
