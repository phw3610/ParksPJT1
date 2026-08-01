import { useRouter } from 'expo-router';
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
import { supabase } from '@/lib/supabase';
import { colors, radius, spacing, typography } from '@/lib/theme';

export default function CreateSpaceScreen() {
  const { user } = useAuth();
  const router = useRouter();
  const [name, setName] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  const handleCreate = async () => {
    if (!name.trim()) {
      Alert.alert('알림', '가족 앨범 이름을 입력해 주세요.');
      return;
    }
    if (!user) return;

    setIsSubmitting(true);
    try {
      // 1. Create space
      const { data: spaceData, error: spaceErr } = await (supabase.from('spaces') as any)
        .insert({ name: name.trim(), owner_id: user.id })
        .select()
        .single();

      if (spaceErr) throw spaceErr;

      // 2. Insert owner member
      const { error: memberErr } = await (supabase.from('space_members') as any).insert({
        space_id: spaceData.id,
        user_id: user.id,
        role: 'owner',
      });

      if (memberErr) throw memberErr;

      // Navigate to connect storage flow (PRD step 4)
      router.replace(`/(app)/spaces/${spaceData.id}/connect-storage`);
    } catch (e: any) {
      Alert.alert('생성 실패', e.message || '앨범을 생성하지 못했습니다.');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <View style={styles.container}>
      <Text style={typography.heading}>앨범 이름 입력</Text>
      <Text style={[typography.caption, styles.subtitle]}>
        예: 박씨네, 우리 가족 앨범, 제주 여행기
      </Text>

      <TextInput
        style={styles.input}
        placeholder="앨범 이름"
        placeholderTextColor={colors.textMuted}
        value={name}
        onChangeText={setName}
        autoFocus
      />

      <TouchableOpacity
        style={[styles.btn, isSubmitting && styles.disabledBtn]}
        onPress={handleCreate}
        disabled={isSubmitting}
      >
        <Text style={styles.btnText}>
          {isSubmitting ? '생성 중...' : '다음 (저장소 연결)'}
        </Text>
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.bg,
    padding: spacing.lg,
  },
  subtitle: {
    marginTop: spacing.xs,
    marginBottom: spacing.lg,
  },
  input: {
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: radius.md,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.md,
    color: colors.text,
    fontSize: 16,
    marginBottom: spacing.xl,
  },
  btn: {
    backgroundColor: colors.primary,
    paddingVertical: spacing.md,
    borderRadius: radius.md,
    alignItems: 'center',
  },
  btnText: {
    color: colors.primaryText,
    fontWeight: '600',
    fontSize: 16,
  },
  disabledBtn: {
    opacity: 0.6,
  },
});
