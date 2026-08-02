import { Image } from 'expo-image';
import { useVideoPlayer, VideoView } from 'expo-video';
import React, { useEffect } from 'react';
import {
  ActivityIndicator,
  StyleSheet,
  Text,
  View,
  type StyleProp,
  type ViewStyle,
} from 'react-native';

import { colors, typography } from '@/lib/theme';

interface VideoPlayerPaneProps {
  /** 재생 티켓 URL. 아직 발급 전이면 null. */
  sourceUri: string | null;
  /** 티켓을 기다리는 동안 보여줄 썸네일. */
  posterUrl?: string;
  /** 현재 화면에 보이는 항목일 때만 true. 아니면 재생을 멈추고 소스를 비운다. */
  isActive: boolean;
  /** 티켓 발급이 실패했을 때 표시할 문구. */
  errorMessage?: string | null;
  style?: StyleProp<ViewStyle>;
}

/**
 * Drive 원본을 download Edge Function으로 스트리밍해 재생한다.
 * 넘겨보는 도중 옆 영상까지 받지 않도록 현재 보이는 항목에만 소스를 붙인다.
 */
export function VideoPlayerPane({
  sourceUri,
  posterUrl,
  isActive,
  errorMessage,
  style,
}: VideoPlayerPaneProps) {
  const canPlay = isActive && Boolean(sourceUri);
  const player = useVideoPlayer(canPlay ? sourceUri : null, (instance) => {
    instance.loop = false;
  });

  useEffect(() => {
    if (!canPlay) {
      player.pause();
    }
  }, [canPlay, player]);

  return (
    <View style={[styles.container, style]}>
      {posterUrl && !canPlay ? (
        <Image
          source={posterUrl}
          style={StyleSheet.absoluteFill}
          contentFit="contain"
          cachePolicy="memory-disk"
          transition={150}
        />
      ) : null}

      {canPlay ? (
        <VideoView
          player={player}
          style={StyleSheet.absoluteFill}
          contentFit="contain"
          nativeControls
          allowsFullscreen
        />
      ) : errorMessage ? (
        <View style={styles.overlay}>
          <Text style={styles.errorText}>{errorMessage}</Text>
        </View>
      ) : isActive ? (
        <View style={styles.overlay}>
          <ActivityIndicator size="large" color={colors.primary} />
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#000000',
  },
  overlay: {
    ...StyleSheet.absoluteFillObject,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: 'rgba(0, 0, 0, 0.4)',
  },
  errorText: {
    ...typography.caption,
    color: colors.text,
    textAlign: 'center',
    paddingHorizontal: 24,
  },
});
