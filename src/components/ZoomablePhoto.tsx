import React, { useCallback, useEffect, useState } from 'react';
import { StyleSheet, type LayoutChangeEvent, type StyleProp, type ViewStyle } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, {
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';

const MIN_SCALE = 1;
const MAX_SCALE = 5;
const DOUBLE_TAP_SCALE = 2.5;
/** 이 배율 아래로 축소하면 원래 크기로 되돌린다. 손을 뗄 때 어중간한 배율이 남지 않게 한다. */
const SNAP_BACK_SCALE = 1.05;

interface ZoomablePhotoProps {
  /** 현재 화면에 보이는 사진일 때만 true. false가 되면 배율을 초기화한다. */
  isActive: boolean;
  /** 확대 여부가 바뀔 때 알린다. 부모는 이 값으로 좌우 스와이프를 잠근다. */
  onZoomChange: (isZoomed: boolean) => void;
  style?: StyleProp<ViewStyle>;
  children: React.ReactNode;
}

/**
 * 핀치 확대·더블탭 확대·확대 상태에서의 이동을 담당한다.
 * 확대 중에는 부모 FlatList의 좌우 스크롤을 꺼야 이동이 가능하므로 onZoomChange로 상태를 올린다.
 */
export function ZoomablePhoto({
  isActive,
  onZoomChange,
  style,
  children,
}: ZoomablePhotoProps) {
  const [isZoomed, setIsZoomed] = useState(false);

  const scale = useSharedValue(1);
  const translateX = useSharedValue(0);
  const translateY = useSharedValue(0);

  const savedScale = useSharedValue(1);
  const savedTranslateX = useSharedValue(0);
  const savedTranslateY = useSharedValue(0);

  const focalStartX = useSharedValue(0);
  const focalStartY = useSharedValue(0);

  const containerWidth = useSharedValue(0);
  const containerHeight = useSharedValue(0);

  /** onZoomChange를 매 프레임 호출하지 않도록 마지막으로 알린 값을 기억한다. */
  const reportedZoom = useSharedValue(false);

  const applyZoomChange = useCallback(
    (next: boolean) => {
      setIsZoomed(next);
      onZoomChange(next);
    },
    [onZoomChange],
  );

  const reportZoom = (next: boolean) => {
    'worklet';
    if (reportedZoom.value === next) return;
    reportedZoom.value = next;
    runOnJS(applyZoomChange)(next);
  };

  const maxOffsetX = () => {
    'worklet';
    return Math.max(0, (containerWidth.value * scale.value - containerWidth.value) / 2);
  };

  const maxOffsetY = () => {
    'worklet';
    return Math.max(0, (containerHeight.value * scale.value - containerHeight.value) / 2);
  };

  const clamp = (value: number, limit: number) => {
    'worklet';
    return Math.min(Math.max(value, -limit), limit);
  };

  const resetZoom = (animated: boolean) => {
    'worklet';
    scale.value = animated ? withTiming(1) : 1;
    translateX.value = animated ? withTiming(0) : 0;
    translateY.value = animated ? withTiming(0) : 0;
    savedScale.value = 1;
    savedTranslateX.value = 0;
    savedTranslateY.value = 0;
    reportZoom(false);
  };

  const settle = () => {
    'worklet';
    if (scale.value < SNAP_BACK_SCALE) {
      resetZoom(true);
      return;
    }
    translateX.value = withTiming(clamp(translateX.value, maxOffsetX()));
    translateY.value = withTiming(clamp(translateY.value, maxOffsetY()));
    savedScale.value = scale.value;
    savedTranslateX.value = clamp(translateX.value, maxOffsetX());
    savedTranslateY.value = clamp(translateY.value, maxOffsetY());
    reportZoom(true);
  };

  const pinch = Gesture.Pinch()
    .onBegin((event) => {
      savedScale.value = scale.value;
      savedTranslateX.value = translateX.value;
      savedTranslateY.value = translateY.value;
      focalStartX.value = event.focalX - containerWidth.value / 2;
      focalStartY.value = event.focalY - containerHeight.value / 2;
    })
    .onUpdate((event) => {
      const nextScale = Math.min(
        Math.max(savedScale.value * event.scale, MIN_SCALE),
        MAX_SCALE,
      );
      const ratio = nextScale / savedScale.value;

      // 두 손가락 사이의 지점이 화면에서 그대로 머물도록 이동량을 함께 보정한다.
      scale.value = nextScale;
      translateX.value = focalStartX.value - ratio * (focalStartX.value - savedTranslateX.value);
      translateY.value = focalStartY.value - ratio * (focalStartY.value - savedTranslateY.value);
      reportZoom(nextScale > MIN_SCALE);
    })
    .onEnd(settle);

  const pan = Gesture.Pan()
    .averageTouches(true)
    .onBegin(() => {
      savedTranslateX.value = translateX.value;
      savedTranslateY.value = translateY.value;
    })
    .onUpdate((event) => {
      translateX.value = clamp(savedTranslateX.value + event.translationX, maxOffsetX());
      translateY.value = clamp(savedTranslateY.value + event.translationY, maxOffsetY());
    })
    .onEnd(settle);

  const doubleTap = Gesture.Tap()
    .numberOfTaps(2)
    .maxDuration(300)
    .onEnd((event) => {
      if (scale.value > MIN_SCALE) {
        resetZoom(true);
        return;
      }

      const focalX = event.x - containerWidth.value / 2;
      const focalY = event.y - containerHeight.value / 2;
      const nextTranslateX = focalX * (1 - DOUBLE_TAP_SCALE);
      const nextTranslateY = focalY * (1 - DOUBLE_TAP_SCALE);
      const limitX = Math.max(
        0,
        (containerWidth.value * DOUBLE_TAP_SCALE - containerWidth.value) / 2,
      );
      const limitY = Math.max(
        0,
        (containerHeight.value * DOUBLE_TAP_SCALE - containerHeight.value) / 2,
      );

      scale.value = withTiming(DOUBLE_TAP_SCALE);
      translateX.value = withTiming(clamp(nextTranslateX, limitX));
      translateY.value = withTiming(clamp(nextTranslateY, limitY));
      savedScale.value = DOUBLE_TAP_SCALE;
      savedTranslateX.value = clamp(nextTranslateX, limitX);
      savedTranslateY.value = clamp(nextTranslateY, limitY);
      reportZoom(true);
    });

  // 확대 전에는 팬을 꺼 둬야 좌우 스와이프로 다음 사진을 넘길 수 있다.
  const gesture = Gesture.Exclusive(
    doubleTap,
    Gesture.Simultaneous(pinch, pan.enabled(isZoomed)),
  );

  // 다른 사진으로 넘어가면 배율을 되돌린다. 돌아왔을 때 확대된 채로 보이지 않게 한다.
  useEffect(() => {
    if (isActive) return;
    scale.value = 1;
    translateX.value = 0;
    translateY.value = 0;
    savedScale.value = 1;
    savedTranslateX.value = 0;
    savedTranslateY.value = 0;
    if (reportedZoom.value) {
      reportedZoom.value = false;
      applyZoomChange(false);
    }
  }, [isActive]);

  const animatedStyle = useAnimatedStyle(() => ({
    transform: [
      { translateX: translateX.value },
      { translateY: translateY.value },
      { scale: scale.value },
    ],
  }));

  const handleLayout = (event: LayoutChangeEvent) => {
    containerWidth.value = event.nativeEvent.layout.width;
    containerHeight.value = event.nativeEvent.layout.height;
  };

  return (
    <GestureDetector gesture={gesture}>
      <Animated.View style={[styles.container, style]} onLayout={handleLayout} collapsable={false}>
        <Animated.View style={[styles.content, animatedStyle]}>{children}</Animated.View>
      </Animated.View>
    </GestureDetector>
  );
}

const styles = StyleSheet.create({
  container: {
    overflow: 'hidden',
  },
  content: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
});
