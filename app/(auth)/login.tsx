import React, { useState } from 'react';
import {
  Alert,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';

import { useAuth } from '@/auth';
import { colors, radius, spacing, typography } from '@/lib/theme';

export default function LoginScreen() {
  const { signInWithGoogle, signInWithEmail } = useAuth();
  const [email, setEmail] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  const handleGoogleSignIn = async () => {
    try {
      await signInWithGoogle();
    } catch (e: any) {
      Alert.alert('로그인 실패', e.message || 'Google 로그인에 실패했습니다.');
    }
  };

  const handleEmailSignIn = async () => {
    if (!email.trim()) {
      Alert.alert('알림', '이메일 주소를 입력해 주세요.');
      return;
    }
    setIsSubmitting(true);
    try {
      await signInWithEmail(email.trim());
      Alert.alert('이메일 발송 완료', '이메일로 전달된 로그인 링크를 확인해 주세요.');
    } catch (e: any) {
      Alert.alert('로그인 실패', e.message || '이메일 로그인에 실패했습니다.');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <Text style={typography.title}>가족 앨범</Text>
        <Text style={[typography.body, styles.subtitle]}>
          "사진은 우리 가족만 보고, 원본은 우리 것이다."
        </Text>
        <Text style={[typography.caption, styles.desc]}>
          사용자 지정 클라우드 스토리지 기반 비공개 가족 공유 앨범
        </Text>
      </View>

      <View style={styles.form}>
        <TouchableOpacity style={styles.googleBtn} onPress={handleGoogleSignIn}>
          <Text style={styles.googleBtnText}>Google 계정으로 계속하기</Text>
        </TouchableOpacity>

        <View style={styles.divider}>
          <View style={styles.dividerLine} />
          <Text style={styles.dividerText}>또는 이메일 매직링크</Text>
          <View style={styles.dividerLine} />
        </View>

        <TextInput
          style={styles.input}
          placeholder="email@example.com"
          placeholderTextColor={colors.textMuted}
          keyboardType="email-address"
          autoCapitalize="none"
          value={email}
          onChangeText={setEmail}
        />

        <TouchableOpacity
          style={[styles.emailBtn, isSubmitting && styles.disabledBtn]}
          onPress={handleEmailSignIn}
          disabled={isSubmitting}
        >
          <Text style={styles.emailBtnText}>
            {isSubmitting ? '전송 중...' : '이메일 매직링크 받기'}
          </Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.bg,
    padding: spacing.lg,
    justifyContent: 'center',
  },
  header: {
    alignItems: 'center',
    marginBottom: spacing.xl,
  },
  subtitle: {
    color: colors.primary,
    marginTop: spacing.sm,
    fontWeight: '600',
    textAlign: 'center',
  },
  desc: {
    textAlign: 'center',
    marginTop: spacing.xs,
  },
  form: {
    backgroundColor: colors.surface,
    padding: spacing.lg,
    borderRadius: radius.md,
    borderColor: colors.border,
    borderWidth: 1,
  },
  googleBtn: {
    backgroundColor: '#ffffff',
    paddingVertical: spacing.md,
    borderRadius: radius.sm,
    alignItems: 'center',
  },
  googleBtnText: {
    color: '#0f172a',
    fontSize: 16,
    fontWeight: '600',
  },
  divider: {
    flexDirection: 'row',
    alignItems: 'center',
    marginVertical: spacing.lg,
  },
  dividerLine: {
    flex: 1,
    height: 1,
    backgroundColor: colors.border,
  },
  dividerText: {
    color: colors.textMuted,
    fontSize: 12,
    marginHorizontal: spacing.sm,
  },
  input: {
    backgroundColor: colors.surfaceAlt,
    borderRadius: radius.sm,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.md,
    color: colors.text,
    fontSize: 15,
    marginBottom: spacing.md,
  },
  emailBtn: {
    backgroundColor: colors.primary,
    paddingVertical: spacing.md,
    borderRadius: radius.sm,
    alignItems: 'center',
  },
  emailBtnText: {
    color: colors.primaryText,
    fontSize: 15,
    fontWeight: '600',
  },
  disabledBtn: {
    opacity: 0.6,
  },
});
