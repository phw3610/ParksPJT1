import { useRouter } from 'expo-router';
import React, { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  RefreshControl,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';

import { useAuth } from '@/auth';
import type { Space } from '@/lib/database.types';
import { supabase } from '@/lib/supabase';
import { colors, radius, spacing, typography } from '@/lib/theme';

interface SpaceWithRole extends Space {
  role: string;
}

export default function SpaceListScreen() {
  const { user, signOut } = useAuth();
  const router = useRouter();
  const [spaces, setSpaces] = useState<SpaceWithRole[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);

  const fetchSpaces = async () => {
    if (!user) return;
    try {
      const { data, error } = await supabase
        .from('space_members')
        .select('role, spaces(*)')
        .eq('user_id', user.id);

      if (error) throw error;

      const items: SpaceWithRole[] = (data || [])
        .map((row: any) => {
          if (!row.spaces || row.spaces.deleted_at) return null;
          return {
            ...row.spaces,
            role: row.role,
          };
        })
        .filter(Boolean);

      setSpaces(items);
    } catch (e) {
      /* 에러 처리 */
    } finally {
      setIsLoading(false);
      setIsRefreshing(false);
    }
  };

  useEffect(() => {
    fetchSpaces();
  }, [user]);

  const onRefresh = () => {
    setIsRefreshing(true);
    fetchSpaces();
  };

  const getRoleLabel = (role: string) => {
    switch (role) {
      case 'owner':
        return '소유자';
      case 'admin':
        return '관리자';
      case 'member':
        return '멤버';
      case 'viewer':
        return '보기 전용';
      default:
        return role;
    }
  };

  return (
    <View style={styles.container}>
      <View style={styles.topBar}>
        <Text style={styles.userEmail}>{user?.email}</Text>
        <TouchableOpacity onPress={signOut} style={styles.logoutBtn}>
          <Text style={styles.logoutText}>로그아웃</Text>
        </TouchableOpacity>
      </View>

      {isLoading ? (
        <View style={styles.center}>
          <ActivityIndicator size="large" color={colors.primary} />
        </View>
      ) : spaces.length === 0 ? (
        <View style={styles.emptyContainer}>
          <Text style={[typography.heading, styles.emptyTitle]}>아직 앨범이 없어요</Text>
          <Text style={[typography.caption, styles.emptySub]}>
            가족 앨범을 만들어 초대해 보세요
          </Text>
          <TouchableOpacity
            style={styles.createBtn}
            onPress={() => router.push('/(app)/spaces/create')}
          >
            <Text style={styles.createBtnText}>+ 새 가족 앨범 만들기</Text>
          </TouchableOpacity>
        </View>
      ) : (
        <FlatList
          data={spaces}
          keyExtractor={(item) => item.id}
          refreshControl={
            <RefreshControl refreshing={isRefreshing} onRefresh={onRefresh} tintColor={colors.primary} />
          }
          contentContainerStyle={styles.listContent}
          renderItem={({ item }) => (
            <TouchableOpacity
              style={styles.spaceCard}
              onPress={() => router.push(`/(app)/spaces/${item.id}`)}
            >
              <View style={styles.cardHeader}>
                <Text style={styles.spaceName}>{item.name}</Text>
                <View style={styles.roleBadge}>
                  <Text style={styles.roleText}>{getRoleLabel(item.role)}</Text>
                </View>
              </View>
              <Text style={typography.caption}>
                생성일: {new Date(item.created_at).toLocaleDateString('ko-KR')}
              </Text>
            </TouchableOpacity>
          )}
          ListFooterComponent={
            <TouchableOpacity
              style={[styles.createBtn, styles.mtLg]}
              onPress={() => router.push('/(app)/spaces/create')}
            >
              <Text style={styles.createBtnText}>+ 새 가족 앨범 만들기</Text>
            </TouchableOpacity>
          }
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
  topBar: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  userEmail: {
    color: colors.textMuted,
    fontSize: 13,
  },
  logoutBtn: {
    paddingVertical: 4,
    paddingHorizontal: 8,
  },
  logoutText: {
    color: colors.danger,
    fontSize: 13,
  },
  center: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  emptyContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: spacing.xl,
  },
  emptyTitle: {
    textAlign: 'center',
    marginBottom: spacing.xs,
  },
  emptySub: {
    textAlign: 'center',
    marginBottom: spacing.xl,
  },
  createBtn: {
    backgroundColor: colors.primary,
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.lg,
    borderRadius: radius.md,
    alignItems: 'center',
  },
  createBtnText: {
    color: colors.primaryText,
    fontWeight: '600',
    fontSize: 15,
  },
  listContent: {
    padding: spacing.md,
  },
  spaceCard: {
    backgroundColor: colors.surface,
    padding: spacing.md,
    borderRadius: radius.md,
    borderColor: colors.border,
    borderWidth: 1,
    marginBottom: spacing.md,
  },
  cardHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: spacing.xs,
  },
  spaceName: {
    fontSize: 18,
    fontWeight: '700',
    color: colors.text,
  },
  roleBadge: {
    backgroundColor: colors.surfaceAlt,
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: radius.sm,
  },
  roleText: {
    color: colors.primary,
    fontSize: 12,
    fontWeight: '600',
  },
  mtLg: {
    marginTop: spacing.md,
  },
});
