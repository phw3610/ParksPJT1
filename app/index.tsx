import { StyleSheet, Text, View } from 'react-native';

import { colors, spacing, typography } from '@/lib/theme';

/**
 * Phase 1 진입점 자리표시자.
 * 다음 작업에서 세션 상태를 보고 (auth)/sign-in 또는 (app)/spaces로 리다이렉트하도록 교체한다.
 */
export default function Index() {
  return (
    <View style={styles.container}>
      <Text style={typography.title}>가족 앨범</Text>
      <Text style={[typography.caption, styles.gap]}>Phase 1 스캐폴딩 진행 중</Text>
      <Text style={[typography.caption, styles.gap]}>Google 드라이브 · 중첩 폴더 · 실시간</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.bg,
    alignItems: 'center',
    justifyContent: 'center',
    padding: spacing.lg,
  },
  gap: { marginTop: spacing.sm },
});
