import { Image } from 'expo-image';
import { getInfoAsync } from 'expo-file-system/legacy';
import * as ImagePicker from 'expo-image-picker';
import { useFocusEffect, useRouter } from 'expo-router';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Modal,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';

import { useAuth } from '@/auth';
import { FolderPickerModal } from '@/components/FolderPickerModal';
import { VideoBadge } from '@/components/VideoBadge';
import type { Asset, Folder, StorageConnection } from '@/lib/database.types';
import { supabase } from '@/lib/supabase';
import { colors, radius, spacing, typography } from '@/lib/theme';
import { getAllItemsForSpace, queueManager, type UploadQueueItem } from '@/queue';
import { useSpaceRealtime } from '@/realtime/useSpaceRealtime';
import { deleteAssets } from '@/storage/client';
import { downloadAssetsToCameraRoll } from '@/storage/downloadToCameraRoll';
import { isReconnectErrorCode } from '@/storage/errors';
import {
  createThumbnailSignedUrls,
  THUMBNAIL_URL_REFRESH_MS,
} from '@/storage/thumbnails';

interface FolderBrowserProps {
  spaceId: string;
  folderId?: string | null;
}

type BreadcrumbFolder = Pick<Folder, 'id' | 'name' | 'path' | 'depth'>;

interface BreadcrumbItem {
  id: string | null;
  name: string;
  isEllipsis?: boolean;
}

function positiveInteger(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value > 0
    ? Math.round(value)
    : null;
}

function capturedAtFromExif(exif: Record<string, unknown> | null | undefined): number | null {
  if (!exif) return null;

  const rawDate = [exif.DateTimeOriginal, exif.DateTimeDigitized, exif.DateTime].find(
    (value): value is string => typeof value === 'string' && value.trim().length > 0,
  );
  if (!rawDate) return null;

  const match = rawDate
    .trim()
    .match(/^(\d{4}):(\d{2}):(\d{2})[ T](\d{2}):(\d{2}):(\d{2})/);
  if (!match) return null;

  const offsetValue = exif.OffsetTimeOriginal;
  const offset =
    typeof offsetValue === 'string' && /^[+-]\d{2}:\d{2}$/.test(offsetValue.trim())
      ? offsetValue.trim()
      : '';
  const [, year, month, day, hour, minute, second] = match;
  const timestamp = Date.parse(`${year}-${month}-${day}T${hour}:${minute}:${second}${offset}`);
  return Number.isFinite(timestamp) ? timestamp : null;
}

async function resolveByteSize(asset: ImagePicker.ImagePickerAsset): Promise<number> {
  const pickerSize = positiveInteger(asset.fileSize);
  if (pickerSize) return pickerSize;

  const fileInfo = await getInfoAsync(asset.uri);
  const actualSize = fileInfo.exists && !fileInfo.isDirectory ? positiveInteger(fileInfo.size) : null;
  if (!actualSize) {
    throw new Error('선택한 파일의 실제 크기를 확인할 수 없습니다.');
  }
  return actualSize;
}

function queueNeedsReconnect(items: UploadQueueItem[], spaceId: string): boolean {
  return items.some(
    (item) =>
      item.space_id === spaceId &&
      item.status === 'paused' &&
      isReconnectErrorCode(item.last_error_code),
  );
}

function escapeLikePattern(value: string): string {
  return value.replace(/[\\%_]/g, '\\$&');
}

export function FolderBrowser({ spaceId, folderId = null }: FolderBrowserProps) {
  const { user } = useAuth();
  const userId = user?.id;
  const router = useRouter();

  const [connection, setConnection] = useState<StorageConnection | null>(null);
  const [hasReconnectPausedItem, setHasReconnectPausedItem] = useState(false);
  /** 저장소 연결·해제는 sc_all 정책상 소유자만 가능하다. 안내 문구를 역할에 맞춰야 한다. */
  const [isOwner, setIsOwner] = useState(false);
  const [canManage, setCanManage] = useState(false);
  const [canWrite, setCanWrite] = useState(false);
  const [currentFolder, setCurrentFolder] = useState<Folder | null>(null);
  const [breadcrumbFolders, setBreadcrumbFolders] = useState<BreadcrumbFolder[]>([]);
  const [isBreadcrumbExpanded, setIsBreadcrumbExpanded] = useState(false);
  const [subFolders, setSubFolders] = useState<Folder[]>([]);
  const [assets, setAssets] = useState<Asset[]>([]);
  const [thumbnailUrls, setThumbnailUrls] = useState<Record<string, string>>({});
  const [isLoading, setIsLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);

  // New folder modal state
  const [showFolderModal, setShowFolderModal] = useState(false);
  const [newFolderName, setNewFolderName] = useState('');
  const [isCreatingFolder, setIsCreatingFolder] = useState(false);
  const [showRenameModal, setShowRenameModal] = useState(false);
  const [renameInput, setRenameInput] = useState('');
  const [isRenamingFolder, setIsRenamingFolder] = useState(false);
  const [showFolderMovePicker, setShowFolderMovePicker] = useState(false);
  const [isMovingFolder, setIsMovingFolder] = useState(false);
  const [isDeletingFolder, setIsDeletingFolder] = useState(false);

  // Multi-select state
  const [selectedAssetIds, setSelectedAssetIds] = useState<Set<string>>(new Set());
  const [isDeletingAssets, setIsDeletingAssets] = useState(false);
  const [isDownloadingAssets, setIsDownloadingAssets] = useState(false);
  const [showFolderPicker, setShowFolderPicker] = useState(false);
  const [isMovingAssets, setIsMovingAssets] = useState(false);
  const isMultiSelect = selectedAssetIds.size > 0;
  const realtimeRefreshTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const fetchData = useCallback(async () => {
    if (!spaceId) return;
    try {
      if (userId) {
        const { data: membership, error: membershipError } = await supabase
          .from('space_members')
          .select('space_id, role')
          .eq('space_id', spaceId)
          .eq('user_id', userId)
          .maybeSingle();

        if (membershipError) throw membershipError;
        if (!membership) {
          router.replace('/(app)/spaces');
          return;
        }
        const role = (membership as { role?: string }).role;
        setIsOwner(role === 'owner');
        setCanManage(role === 'owner' || role === 'admin');
        setCanWrite(role === 'owner' || role === 'admin' || role === 'member');
      }

      // 1. Connection status
      const { data: conn } = await supabase
        .from('storage_connections')
        .select(
          'id,space_id,provider,connected_by,account_label,root_folder_id,is_active,last_error,last_verified_at,created_at',
        )
        .eq('space_id', spaceId)
        .eq('is_active', true)
        .maybeSingle();
      setConnection(conn);

      // 2. Current folder if subfolder
      if (folderId) {
        const { data: f, error: folderError } = await supabase
          .from('folders')
          .select('*')
          .eq('id', folderId)
          .single();
        if (folderError) throw folderError;
        const folder = f as Folder;
        setCurrentFolder(folder);

        const pathSegments = folder.path.split('/').filter(Boolean);
        const pathPrefixes = pathSegments.map((_, index) =>
          pathSegments.slice(0, index + 1).join('/'),
        );
        const { data: ancestors, error: ancestorsError } = await supabase
          .from('folders')
          .select('id,name,path,depth')
          .eq('space_id', spaceId)
          .is('deleted_at', null)
          .in('path', pathPrefixes);
        if (ancestorsError) throw ancestorsError;

        const orderByPath = new Map(pathPrefixes.map((path, index) => [path, index]));
        const ancestorRows = (ancestors || []) as BreadcrumbFolder[];
        setBreadcrumbFolders(
          ancestorRows.sort(
            (left, right) =>
              (orderByPath.get(left.path) ?? Number.MAX_SAFE_INTEGER) -
              (orderByPath.get(right.path) ?? Number.MAX_SAFE_INTEGER),
          ),
        );
      } else {
        setCurrentFolder(null);
        setBreadcrumbFolders([]);
      }

      // 3. Subfolders
      let folderQuery = supabase.from('folders').select('*').eq('space_id', spaceId).is('deleted_at', null);
      if (folderId) {
        folderQuery = folderQuery.eq('parent_id', folderId);
      } else {
        folderQuery = folderQuery.is('parent_id', null);
      }
      const { data: subF } = await folderQuery.order('name', { ascending: true });
      setSubFolders(subF || []);

      // 4. Assets in this folder
      let assetQuery = supabase.from('assets').select('*').eq('space_id', spaceId).is('deleted_at', null);
      if (folderId) {
        assetQuery = assetQuery.eq('folder_id', folderId);
      } else {
        assetQuery = assetQuery.is('folder_id', null);
      }
      // 상세 화면의 좌우 스와이프가 그리드와 같은 순서를 따라야 하므로 정렬을 고정한다.
      const { data: ass } = await assetQuery
        .order('captured_at', { ascending: false, nullsFirst: false })
        .order('created_at', { ascending: false });
      setAssets(ass || []);
    } catch {
      /* 에러 무시 */
    } finally {
      setIsLoading(false);
      setIsRefreshing(false);
    }
  }, [folderId, router, spaceId, userId]);

  useFocusEffect(
    useCallback(() => {
      void fetchData();
    }, [fetchData]),
  );

  useEffect(() => {
    setIsBreadcrumbExpanded(false);
  }, [folderId]);

  useEffect(() => {
    let isCancelled = false;
    let unsubscribe: (() => void) | undefined;

    const refreshReconnectState = async () => {
      const items = await getAllItemsForSpace(spaceId);
      if (!isCancelled) setHasReconnectPausedItem(queueNeedsReconnect(items, spaceId));
    };

    const observeQueue = async () => {
      await queueManager.init();
      if (isCancelled) return;
      unsubscribe = queueManager.subscribe(() => {
        void refreshReconnectState();
      });
      await refreshReconnectState();
    };

    void observeQueue();
    return () => {
      isCancelled = true;
      unsubscribe?.();
    };
  }, [spaceId]);

  useEffect(() => {
    let isCancelled = false;

    const refreshThumbnailUrls = async () => {
      try {
        const urls = await createThumbnailSignedUrls(assets);
        if (!isCancelled) setThumbnailUrls(urls);
      } catch {
        if (!isCancelled) setThumbnailUrls({});
      }
    };

    void refreshThumbnailUrls();
    const refreshTimer = setInterval(() => {
      void refreshThumbnailUrls();
    }, THUMBNAIL_URL_REFRESH_MS);

    return () => {
      isCancelled = true;
      clearInterval(refreshTimer);
    };
  }, [assets]);

  const scheduleRealtimeRefresh = useCallback(() => {
    if (realtimeRefreshTimer.current) clearTimeout(realtimeRefreshTimer.current);
    realtimeRefreshTimer.current = setTimeout(() => {
      realtimeRefreshTimer.current = null;
      void fetchData();
    }, 250);
  }, [fetchData]);

  useEffect(() => {
    return () => {
      if (realtimeRefreshTimer.current) clearTimeout(realtimeRefreshTimer.current);
      realtimeRefreshTimer.current = null;
    };
  }, [fetchData]);

  useSpaceRealtime({
    spaceId,
    onAssetsChange: scheduleRealtimeRefresh,
    onFoldersChange: scheduleRealtimeRefresh,
    onMembersChange: scheduleRealtimeRefresh,
  });

  const onRefresh = () => {
    setIsRefreshing(true);
    void fetchData();
  };

  const handleCreateFolder = async () => {
    if (!newFolderName.trim()) {
      Alert.alert('알림', '폴더 이름을 입력해 주세요.');
      return;
    }
    if (!user) return;
    setIsCreatingFolder(true);

    try {
      const parentPath = currentFolder ? currentFolder.path : '';
      const path = `${parentPath}/${newFolderName.trim()}`;
      const depth = currentFolder ? currentFolder.depth + 1 : 0;

      const { error } = await (supabase.from('folders') as any).insert({
        space_id: spaceId,
        parent_id: folderId,
        name: newFolderName.trim(),
        path,
        depth,
        created_by: user.id,
      });

      if (error) throw error;
      setNewFolderName('');
      setShowFolderModal(false);
      void fetchData();
    } catch (e: any) {
      Alert.alert('폴더 생성 실패', e.message);
    } finally {
      setIsCreatingFolder(false);
    }
  };

  const openRenameModal = () => {
    if (!currentFolder) return;
    setRenameInput(currentFolder.name);
    setShowRenameModal(true);
  };

  const handleRenameFolder = async () => {
    if (!currentFolder) return;
    const trimmed = renameInput.trim();
    if (trimmed.length < 1 || trimmed.length > 100) {
      Alert.alert('알림', '폴더 이름은 1자 이상 100자 이하로 입력해 주세요.');
      return;
    }
    if (trimmed === currentFolder.name) {
      setShowRenameModal(false);
      return;
    }

    setIsRenamingFolder(true);
    try {
      const { data, error } = await (supabase.from('folders') as any)
        .update({ name: trimmed })
        .eq('id', currentFolder.id)
        .eq('space_id', spaceId)
        .select('id')
        .maybeSingle();

      if (error) throw error;
      if (!data) throw new Error('폴더를 변경할 권한이 없거나 폴더를 찾을 수 없습니다.');

      setShowRenameModal(false);
      await fetchData();
      Alert.alert('완료', '폴더 이름이 변경되었습니다.');
    } catch (error: any) {
      Alert.alert('수정 실패', error?.message || '폴더 이름을 변경하지 못했습니다.');
    } finally {
      setIsRenamingFolder(false);
    }
  };

  const handleMoveCurrentFolder = async (
    targetParentId: string | null,
    targetFolderName: string,
  ) => {
    if (!currentFolder || isMovingFolder) return;

    if (targetParentId === currentFolder.parent_id) {
      setShowFolderMovePicker(false);
      Alert.alert('알림', '이미 선택한 위치에 있는 폴더입니다.');
      return;
    }

    setIsMovingFolder(true);
    try {
      // path와 depth는 folders_guard 및 cascade 트리거가 계산한다.
      const { data, error } = await (supabase.from('folders') as any)
        .update({ parent_id: targetParentId })
        .eq('id', currentFolder.id)
        .eq('space_id', spaceId)
        .select('id,parent_id,path,depth')
        .maybeSingle();

      if (error) throw error;
      if (!data) throw new Error('폴더를 이동할 권한이 없거나 폴더를 찾을 수 없습니다.');

      setShowFolderMovePicker(false);
      await fetchData();
      Alert.alert('이동 완료', `'${currentFolder.name}' 폴더를 '${targetFolderName}'으로 이동했어요.`);
    } catch (error: any) {
      setShowFolderMovePicker(false);
      Alert.alert('이동 실패', error?.message || '폴더를 이동하지 못했습니다.');
    } finally {
      setIsMovingFolder(false);
    }
  };

  const handleDeleteCurrentFolder = async () => {
    if (!currentFolder || !canManage || isDeletingFolder) return;

    const folderToDelete = currentFolder;
    setIsDeletingFolder(true);
    try {
      const descendantPattern = `${escapeLikePattern(folderToDelete.path)}/%`;
      const {
        data: descendantFolders,
        count: descendantCount,
        error: descendantError,
      } = await supabase
        .from('folders')
        .select('id', { count: 'exact' })
        .eq('space_id', spaceId)
        .is('deleted_at', null)
        .like('path', descendantPattern);

      if (descendantError) throw descendantError;

      const affectedFolderIds = [
        folderToDelete.id,
        ...((descendantFolders || []) as Array<{ id: string }>).map((folder) => folder.id),
      ];
      const { count: affectedAssetCount, error: assetCountError } = await supabase
        .from('assets')
        .select('id', { count: 'exact', head: true })
        .eq('space_id', spaceId)
        .is('deleted_at', null)
        .in('folder_id', affectedFolderIds);

      if (assetCountError) throw assetCountError;

      Alert.alert(
        '폴더 삭제',
        `'${folderToDelete.name}' 폴더와 하위 폴더 ${descendantCount ?? 0}개를 삭제할까요?\n\n이 폴더들에 있는 사진 ${affectedAssetCount ?? 0}장은 앨범 최상위로 이동해 앱에서 계속 보입니다. Google Drive 원본은 삭제되지 않습니다.`,
        [
          {
            text: '취소',
            style: 'cancel',
            onPress: () => setIsDeletingFolder(false),
          },
          {
            text: '삭제',
            style: 'destructive',
            onPress: async () => {
              try {
                const { data, error } = await (supabase.from('folders') as any)
                  .delete()
                  .eq('id', folderToDelete.id)
                  .eq('space_id', spaceId)
                  .select('id')
                  .maybeSingle();

                if (error) throw error;
                if (!data) {
                  throw new Error('폴더를 삭제할 권한이 없거나 폴더를 찾을 수 없습니다.');
                }

                // 상위 화면이 다시 포커스되며 기존 useFocusEffect의 fetchData가 목록을 갱신한다.
                if (folderToDelete.parent_id) {
                  router.dismissTo(
                    `/(app)/spaces/${spaceId}/folder/${folderToDelete.parent_id}`,
                  );
                } else {
                  router.dismissTo(`/(app)/spaces/${spaceId}`);
                }
                Alert.alert(
                  '삭제 완료',
                  `폴더를 삭제했습니다. 사진 ${affectedAssetCount ?? 0}장은 앨범 최상위에서 계속 볼 수 있고 Google Drive 원본은 그대로 남아 있습니다.`,
                );
              } catch (error: any) {
                Alert.alert('삭제 실패', error?.message || '폴더를 삭제하지 못했습니다.');
              } finally {
                setIsDeletingFolder(false);
              }
            },
          },
        ],
        { cancelable: false },
      );
    } catch (error: any) {
      setIsDeletingFolder(false);
      Alert.alert('삭제 정보 확인 실패', error?.message || '폴더 내용을 확인하지 못했습니다.');
    }
  };

  const handleUploadClick = async () => {
    const connectionNeedsReconnect = isReconnectErrorCode(connection?.last_error?.toUpperCase());
    if (hasReconnectPausedItem || connectionNeedsReconnect) {
      if (isOwner) {
        Alert.alert('Google Drive 재인증 필요', '저장소를 다시 연결하면 멈춘 업로드가 이어집니다.', [
          { text: '취소', style: 'cancel' },
          {
            text: '재인증하기',
            onPress: () => router.push(`/(app)/spaces/${spaceId}/connect-storage`),
          },
        ]);
      } else {
        Alert.alert(
          'Google Drive 재인증 필요',
          '업로드가 멈춰 있어요. 앨범 소유자에게 Google Drive 재인증을 요청해 주세요.',
        );
      }
      return;
    }

    if (!connection) {
      // 저장소 연결은 소유자만 가능하다. 비소유자에게 링크를 주면 막힌 화면으로 보내게 된다.
      if (isOwner) {
        Alert.alert('저장소 미연결', '사진을 올리려면 먼저 저장소를 연결해 주세요.', [
          { text: '취소', style: 'cancel' },
          {
            text: '연결하기',
            onPress: () => router.push(`/(app)/spaces/${spaceId}/connect-storage`),
          },
        ]);
      } else {
        Alert.alert(
          '저장소 미연결',
          '아직 저장소가 연결되지 않아 사진을 올릴 수 없어요.\n앨범 소유자에게 저장소 연결을 요청해 주세요.',
        );
      }
      return;
    }

    const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!perm.granted) {
      Alert.alert('권한 필요', '사진 선택을 위한 미디어 라이브러리 접근 권한이 필요합니다.');
      return;
    }

    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images', 'videos'],
      allowsMultipleSelection: true,
      quality: 1,
      exif: true,
    });

    if (result.canceled || !result.assets) return;

    const skippedFiles: string[] = [];
    let enqueuedCount = 0;

    for (const item of result.assets) {
      const fileName = item.fileName || `IMG_${Date.now()}.${item.type === 'video' ? 'mp4' : 'jpg'}`;
      const mimeType = item.mimeType || (item.type === 'video' ? 'video/mp4' : 'image/jpeg');

      try {
        const byteSize = await resolveByteSize(item);
        await queueManager.enqueue({
          spaceId,
          folderId,
          fileUri: item.uri,
          originalName: fileName,
          mimeType,
          byteSize,
          capturedAt: capturedAtFromExif(item.exif),
          width: positiveInteger(item.width),
          height: positiveInteger(item.height),
          durationMs: positiveInteger(item.duration),
          kind: item.type === 'video' ? 'video' : 'image',
        });
        enqueuedCount += 1;
      } catch (error) {
        skippedFiles.push(fileName);
        console.error('[upload-queue] Failed to prepare selected file', {
          fileName,
          uri: item.uri,
          error,
        });
      }
    }

    if (enqueuedCount === 0) {
      Alert.alert(
        '업로드 준비 실패',
        '선택한 파일의 실제 크기를 확인하지 못해 업로드 큐에 추가하지 않았습니다.',
      );
      return;
    }

    if (skippedFiles.length > 0) {
      Alert.alert(
        '일부 파일 준비 실패',
        `${enqueuedCount}개는 업로드 큐에 추가했고 ${skippedFiles.length}개는 파일 정보를 확인하지 못해 제외했습니다.`,
      );
    }
    router.push(`/(app)/spaces/${spaceId}/queue`);
  };

  const toggleSelectAsset = (id: string) => {
    const next = new Set(selectedAssetIds);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setSelectedAssetIds(next);
  };

  const handleDownloadSelected = async () => {
    const assetIds = Array.from(selectedAssetIds);
    if (assetIds.length === 0 || isDownloadingAssets) return;

    setIsDownloadingAssets(true);
    try {
      const selected = assets.filter((asset) => selectedAssetIds.has(asset.id));
      const { succeeded, failed } = await downloadAssetsToCameraRoll(
        selected.map((asset) => ({ assetId: asset.id, fileName: asset.original_name })),
      );

      if (failed.length === 0) {
        setSelectedAssetIds(new Set());
        Alert.alert('다운로드 완료', `${succeeded.length}장을 카메라롤에 저장했어요.`);
      } else {
        Alert.alert(
          '일부 저장 실패',
          `${succeeded.length}장 저장, ${failed.length}장 실패\n${failed[0].error.message}`,
        );
      }
    } catch (error: any) {
      Alert.alert('다운로드 실패', error?.message || '사진을 저장하지 못했습니다.');
    } finally {
      setIsDownloadingAssets(false);
    }
  };

  const handleMoveSelected = async (targetFolderId: string | null, targetFolderName: string) => {
    const assetIds = Array.from(selectedAssetIds);
    if (assetIds.length === 0 || isMovingAssets) return;

    if (targetFolderId === folderId) {
      setShowFolderPicker(false);
      Alert.alert('알림', '이미 선택한 폴더에 있는 사진입니다.');
      return;
    }

    setIsMovingAssets(true);
    try {
      const { data, error } = await (supabase.from('assets') as any)
        .update({ folder_id: targetFolderId })
        .eq('space_id', spaceId)
        .in('id', assetIds)
        .select('id');

      if (error) throw error;

      const movedRows = (data || []) as Array<{ id: string }>;
      const movedIds = new Set(movedRows.map((asset) => asset.id));
      const unmovedIds = assetIds.filter((assetId) => !movedIds.has(assetId));

      setShowFolderPicker(false);
      setAssets((current) => current.filter((asset) => !movedIds.has(asset.id)));
      setSelectedAssetIds(new Set(unmovedIds));
      await fetchData();

      if (unmovedIds.length === 0) {
        Alert.alert('이동 완료', `${movedIds.size}장의 사진을 '${targetFolderName}'으로 이동했어요.`);
      } else if (movedIds.size === 0) {
        Alert.alert(
          '이동할 수 없음',
          '선택한 사진을 이동하지 못했습니다. 멤버는 자신이 올린 사진만 옮길 수 있어요.',
        );
      } else {
        Alert.alert(
          '일부 사진만 이동됨',
          `${movedIds.size}장 이동, ${unmovedIds.length}장 미이동\n멤버는 자신이 올린 사진만 옮길 수 있어요.`,
        );
      }
    } catch (error: any) {
      setShowFolderPicker(false);
      Alert.alert('이동 실패', error?.message || '사진을 이동하지 못했습니다.');
    } finally {
      setIsMovingAssets(false);
    }
  };

  const handleDeleteSelected = () => {
    const assetIds = Array.from(selectedAssetIds);
    if (assetIds.length === 0 || isDeletingAssets) return;

    Alert.alert(
      '사진 삭제',
      `선택한 ${assetIds.length}장의 사진을 Google Drive 휴지통으로 옮길까요?\n앱 목록에서는 사라지며, 복구하려면 Google Drive에서 해야 합니다.`,
      [
        { text: '취소', style: 'cancel' },
        {
          text: '삭제',
          style: 'destructive',
          onPress: async () => {
            setIsDeletingAssets(true);
            try {
              await deleteAssets(assetIds, true);
              const deletedIds = new Set(assetIds);
              setAssets((current) => current.filter((asset) => !deletedIds.has(asset.id)));
              setSelectedAssetIds(new Set());
              await fetchData();
              Alert.alert(
                '삭제 완료',
                `${assetIds.length}장의 사진을 Google Drive 휴지통으로 옮겼어요.\n앱 목록에서는 사라졌으며, 복구하려면 Google Drive에서 복원해 주세요.`,
              );
            } catch (error: any) {
              Alert.alert('삭제 실패', error?.message || '사진을 삭제하지 못했습니다.');
            } finally {
              setIsDeletingAssets(false);
            }
          },
        },
      ],
    );
  };

  const allBreadcrumbItems: BreadcrumbItem[] = [
    { id: null, name: '앨범' },
    ...breadcrumbFolders.map((folder) => ({ id: folder.id, name: folder.name })),
  ];
  const visibleBreadcrumbItems: BreadcrumbItem[] =
    allBreadcrumbItems.length > 4 && !isBreadcrumbExpanded
      ? [
          allBreadcrumbItems[0],
          { id: null, name: '…', isEllipsis: true },
          ...allBreadcrumbItems.slice(-2),
        ]
      : allBreadcrumbItems;

  const handleBreadcrumbPress = (item: BreadcrumbItem) => {
    if (item.isEllipsis) {
      setIsBreadcrumbExpanded(true);
      return;
    }
    if (item.id === folderId || (item.id === null && folderId === null)) return;

    setIsBreadcrumbExpanded(false);
    if (item.id) {
      router.dismissTo(`/(app)/spaces/${spaceId}/folder/${item.id}`);
    } else {
      router.dismissTo(`/(app)/spaces/${spaceId}`);
    }
  };

  const connectionNeedsReconnect = isReconnectErrorCode(connection?.last_error?.toUpperCase());
  const needsStorageReconnect = hasReconnectPausedItem || connectionNeedsReconnect;

  return (
    <View style={styles.container}>
      {/* 1. Storage Disconnected Warning Banner */}
      {needsStorageReconnect ? (
        isOwner ? (
          <TouchableOpacity
            style={styles.warningBanner}
            onPress={() => router.push(`/(app)/spaces/${spaceId}/connect-storage`)}
          >
            <Text style={styles.warningText}>
              ⚠️ Google Drive 재인증이 필요해 업로드가 멈췄어요 [재인증하기]
            </Text>
          </TouchableOpacity>
        ) : (
          <View style={styles.warningBanner}>
            <Text style={styles.warningText}>
              ⚠️ 업로드가 멈췄어요. 앨범 소유자에게 Google Drive 재인증을 요청해 주세요
            </Text>
          </View>
        )
      ) : !connection &&
        (isOwner ? (
          <TouchableOpacity
            style={styles.warningBanner}
            onPress={() => router.push(`/(app)/spaces/${spaceId}/connect-storage`)}
          >
            <Text style={styles.warningText}>
              ⚠️ 사진을 올리려면 저장소를 연결해 주세요 [연결하기]
            </Text>
          </TouchableOpacity>
        ) : (
          <View style={styles.warningBanner}>
            <Text style={styles.warningText}>
              ⚠️ 아직 저장소가 연결되지 않았어요. 앨범 소유자에게 요청해 주세요
            </Text>
          </View>
        ))}

      {/* 2. Top Header / Actions Bar */}
      <View style={styles.headerBar}>
        <View style={styles.headerLeft}>
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.breadcrumbContent}
          >
            {visibleBreadcrumbItems.map((item, index) => {
              const isCurrent =
                !item.isEllipsis &&
                (item.id === folderId || (item.id === null && folderId === null));
              return (
                <React.Fragment key={item.isEllipsis ? 'ellipsis' : item.id || 'root'}>
                  {index > 0 && <Text style={styles.breadcrumbSeparator}>›</Text>}
                  <TouchableOpacity
                    style={styles.breadcrumbButton}
                    onPress={() => handleBreadcrumbPress(item)}
                    accessibilityRole="button"
                    accessibilityState={{ selected: isCurrent }}
                    accessibilityLabel={
                      item.isEllipsis ? '숨겨진 상위 폴더 펼치기' : `${item.name} 폴더로 이동`
                    }
                  >
                    <Text
                      style={[
                        styles.breadcrumbText,
                        isCurrent && styles.breadcrumbCurrentText,
                      ]}
                      numberOfLines={1}
                    >
                      {item.name}
                    </Text>
                  </TouchableOpacity>
                </React.Fragment>
              );
            })}
          </ScrollView>
        </View>

        <View style={styles.headerRight}>
          <TouchableOpacity
            style={styles.iconBtn}
            onPress={() => router.push(`/(app)/spaces/${spaceId}/members`)}
          >
            <Text style={styles.iconBtnText}>👥 멤버</Text>
          </TouchableOpacity>
          {/* ⚙️ 설정(저장소 연결)은 스페이스 홈 헤더로 옮겼다. 소유자에게만 보여야 하는데
              여기서는 역할과 무관하게 노출됐고, 하위 폴더에서도 중복으로 떴다. */}
        </View>
      </View>

      {currentFolder && canWrite && (
        <View style={styles.folderActionBar}>
          <Text style={styles.folderActionTitle} numberOfLines={1}>
            📁 {currentFolder.name}
          </Text>
          <View style={styles.folderActionButtons}>
            <TouchableOpacity
              style={styles.folderActionButton}
              onPress={openRenameModal}
              disabled={isMovingFolder || isDeletingFolder}
            >
              <Text style={styles.folderActionText}>이름 변경</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={styles.folderActionButton}
              onPress={() => setShowFolderMovePicker(true)}
              disabled={isMovingFolder || isDeletingFolder}
            >
              <Text style={styles.folderActionText}>
                {isMovingFolder ? '이동 중...' : '폴더 이동'}
              </Text>
            </TouchableOpacity>
            {canManage && (
              <TouchableOpacity
                style={[styles.folderActionButton, styles.folderDeleteButton]}
                onPress={() => void handleDeleteCurrentFolder()}
                disabled={isMovingFolder || isDeletingFolder}
              >
                <Text style={styles.folderDeleteText}>
                  {isDeletingFolder ? '확인 중...' : '폴더 삭제'}
                </Text>
              </TouchableOpacity>
            )}
          </View>
        </View>
      )}

      {/* 3. Folder & Asset Content */}
      {isLoading ? (
        <View style={styles.center}>
          <ActivityIndicator size="large" color={colors.primary} />
        </View>
      ) : subFolders.length === 0 && assets.length === 0 ? (
        <View style={styles.emptyContainer}>
          <Text style={typography.heading}>이 폴더에는 아직 사진이 없어요</Text>
          <Text style={[typography.caption, styles.mtSm]}>
            아래 [+] 버튼을 눌러 사진을 올려보세요.
          </Text>
          {canWrite && (
            <TouchableOpacity
              style={[styles.addFolderBtn, styles.emptyFolderBtn]}
              onPress={() => setShowFolderModal(true)}
            >
              <Text style={styles.addFolderBtnText}>새 폴더 만들기</Text>
            </TouchableOpacity>
          )}
        </View>
      ) : (
        <FlatList
          data={assets}
          keyExtractor={(item) => item.id}
          numColumns={3}
          refreshControl={
            <RefreshControl refreshing={isRefreshing} onRefresh={onRefresh} tintColor={colors.primary} />
          }
          ListHeaderComponent={
            subFolders.length > 0 ? (
              <View style={styles.subFolderSection}>
                <View style={styles.sectionHeader}>
                  <Text style={styles.sectionTitle}>하위 폴더 ({subFolders.length})</Text>
                  {canWrite && (
                    <TouchableOpacity onPress={() => setShowFolderModal(true)}>
                      <Text style={styles.addFolderText}>+ 새 폴더</Text>
                    </TouchableOpacity>
                  )}
                </View>

                <View style={styles.folderGrid}>
                  {subFolders.map((sf) => (
                    <TouchableOpacity
                      key={sf.id}
                      style={styles.folderCard}
                      onPress={() =>
                        router.push(`/(app)/spaces/${spaceId}/folder/${sf.id}`)
                      }
                    >
                      <Text style={styles.folderIcon}>📁</Text>
                      <Text style={styles.folderName} numberOfLines={1}>
                        {sf.name}
                      </Text>
                    </TouchableOpacity>
                  ))}
                </View>
              </View>
            ) : (
              <View style={styles.subFolderSection}>
                {canWrite && (
                  <TouchableOpacity
                    style={styles.addFolderBtn}
                    onPress={() => setShowFolderModal(true)}
                  >
                    <Text style={styles.addFolderBtnText}>+ 새 폴더 만들기</Text>
                  </TouchableOpacity>
                )}
              </View>
            )
          }
          renderItem={({ item }) => {
            const isSelected = selectedAssetIds.has(item.id);
            const thumbnailUrl = thumbnailUrls[item.id];
            const thumbnailPlaceholder =
              item.status === 'pending' || item.status === 'uploading'
                ? '처리 중'
                : item.status === 'failed'
                  ? '업로드 실패'
                  : item.thumb_path
                    ? '미리보기 불러오는 중'
                    : '미리보기 없음';
            return (
              <TouchableOpacity
                style={[styles.assetCell, isSelected && styles.assetSelected]}
                onPress={() => {
                  if (isMultiSelect) {
                    toggleSelectAsset(item.id);
                  } else {
                    router.push(`/(app)/spaces/${spaceId}/asset/${item.id}`);
                  }
                }}
                onLongPress={() => toggleSelectAsset(item.id)}
              >
                <View style={styles.photoPlaceholder}>
                  {thumbnailUrl ? (
                    <Image
                      source={thumbnailUrl}
                      style={styles.thumbnail}
                      contentFit="cover"
                      cachePolicy="memory-disk"
                      recyclingKey={item.id}
                      transition={150}
                      accessibilityLabel={item.original_name}
                      onError={() => {
                        setThumbnailUrls((current) => {
                          if (!current[item.id]) return current;
                          const next = { ...current };
                          delete next[item.id];
                          return next;
                        });
                      }}
                    />
                  ) : (
                    <View style={styles.photoPlaceholderContent}>
                      <Text style={styles.photoIcon}>{item.kind === 'video' ? '🎬' : '📷'}</Text>
                      <Text style={styles.photoPlaceholderText}>{thumbnailPlaceholder}</Text>
                    </View>
                  )}
                  {item.kind === 'video' && <VideoBadge durationMs={item.duration_ms} />}
                  <View style={styles.photoNameBackdrop}>
                    <Text style={styles.photoName} numberOfLines={1}>
                      {item.original_name}
                    </Text>
                  </View>
                </View>
                {isSelected && <View style={styles.checkBadge}><Text style={styles.checkText}>✓</Text></View>}
              </TouchableOpacity>
            );
          }}
        />
      )}

      {/* Multi-select Action Bar */}
      {isMultiSelect && (
        <View style={styles.multiActionBar}>
          <Text style={styles.multiCount}>{selectedAssetIds.size}개 선택됨</Text>
          <View style={styles.multiBtns}>
            <TouchableOpacity
              style={[styles.multiBtn, isDownloadingAssets && styles.disabledBtn]}
              onPress={handleDownloadSelected}
              disabled={isDownloadingAssets}
            >
              <Text style={styles.multiBtnText}>
                {isDownloadingAssets ? '저장 중...' : '다운로드'}
              </Text>
            </TouchableOpacity>
            {canWrite && (
              <TouchableOpacity
                style={[styles.multiBtn, isMovingAssets && styles.disabledBtn]}
                onPress={() => setShowFolderPicker(true)}
                disabled={isMovingAssets}
              >
                <Text style={styles.multiBtnText}>
                  {isMovingAssets ? '이동 중...' : '이동'}
                </Text>
              </TouchableOpacity>
            )}
            <TouchableOpacity
              style={[
                styles.multiBtn,
                styles.multiDeleteBtn,
                isDeletingAssets && styles.disabledBtn,
              ]}
              onPress={handleDeleteSelected}
              disabled={isDeletingAssets}
            >
              <Text style={styles.multiDeleteText}>
                {isDeletingAssets ? '삭제 중...' : '삭제'}
              </Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.multiBtn, styles.cancelBtn]}
              onPress={() => setSelectedAssetIds(new Set())}
            >
              <Text style={styles.cancelBtnText}>취소</Text>
            </TouchableOpacity>
          </View>
        </View>
      )}

      <FolderPickerModal
        visible={showFolderPicker}
        spaceId={spaceId}
        currentFolderId={folderId}
        busy={isMovingAssets}
        onClose={() => setShowFolderPicker(false)}
        onSelect={(targetFolderId, targetFolderName) => {
          void handleMoveSelected(targetFolderId, targetFolderName);
        }}
      />

      <FolderPickerModal
        visible={showFolderMovePicker}
        spaceId={spaceId}
        currentFolderId={currentFolder?.parent_id ?? null}
        excludedPathPrefix={currentFolder?.path ?? null}
        busy={isMovingFolder}
        onClose={() => setShowFolderMovePicker(false)}
        onSelect={(targetParentId, targetFolderName) => {
          void handleMoveCurrentFolder(targetParentId, targetFolderName);
        }}
      />

      {/* Floating [+] Upload Button */}
      {!isMultiSelect && (
        <TouchableOpacity style={styles.fab} onPress={handleUploadClick}>
          <Text style={styles.fabText}>+</Text>
        </TouchableOpacity>
      )}

      {/* New Folder Modal */}
      <Modal visible={showFolderModal} transparent animationType="fade">
        <View style={styles.modalOverlay}>
          <View style={styles.modalCard}>
            <Text style={typography.heading}>새 폴더 생성</Text>
            <TextInput
              style={styles.modalInput}
              placeholder="폴더 이름"
              placeholderTextColor={colors.textMuted}
              value={newFolderName}
              onChangeText={setNewFolderName}
              autoFocus
            />
            <View style={styles.modalActions}>
              <TouchableOpacity style={styles.modalCancelBtn} onPress={() => setShowFolderModal(false)}>
                <Text style={styles.modalCancelText}>취소</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.modalConfirmBtn, isCreatingFolder && styles.disabledBtn]}
                onPress={handleCreateFolder}
                disabled={isCreatingFolder}
              >
                <Text style={styles.modalConfirmText}>생성</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      {/* Rename Folder Modal — 스페이스 이름 변경과 동일한 입력 패턴 */}
      <Modal visible={showRenameModal} transparent animationType="fade">
        <View style={styles.modalOverlay}>
          <View style={styles.modalCard}>
            <Text style={typography.heading}>폴더 이름 변경</Text>
            <Text style={[typography.caption, styles.modalSub]}>
              1자 이상 100자 이하로 입력해 주세요.
            </Text>
            <TextInput
              style={styles.modalInput}
              placeholder="폴더 이름"
              placeholderTextColor={colors.textMuted}
              value={renameInput}
              onChangeText={setRenameInput}
              maxLength={100}
              autoFocus
            />
            <View style={styles.modalActions}>
              <TouchableOpacity
                style={styles.modalCancelBtn}
                onPress={() => setShowRenameModal(false)}
              >
                <Text style={styles.modalCancelText}>취소</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.modalConfirmBtn, isRenamingFolder && styles.disabledBtn]}
                onPress={handleRenameFolder}
                disabled={isRenamingFolder}
              >
                <Text style={styles.modalConfirmText}>저장</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.bg,
  },
  warningBanner: {
    backgroundColor: 'rgba(251, 191, 36, 0.2)',
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
    borderColor: colors.warning,
    borderBottomWidth: 1,
  },
  warningText: {
    color: colors.warning,
    fontSize: 13,
    fontWeight: '600',
    textAlign: 'center',
  },
  headerBar: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  headerLeft: {
    flex: 1,
    minWidth: 0,
    marginRight: spacing.xs,
  },
  breadcrumbContent: {
    alignItems: 'center',
    paddingVertical: 2,
  },
  breadcrumbButton: {
    maxWidth: 120,
    paddingHorizontal: 3,
    paddingVertical: 4,
  },
  breadcrumbText: {
    color: colors.textMuted,
    fontSize: 13,
    fontWeight: '500',
  },
  breadcrumbCurrentText: {
    color: colors.text,
    fontWeight: '700',
  },
  breadcrumbSeparator: {
    color: colors.textMuted,
    marginHorizontal: 2,
    fontSize: 15,
  },
  headerRight: {
    flexDirection: 'row',
    gap: spacing.xs,
    flexShrink: 0,
  },
  iconBtn: {
    backgroundColor: colors.surfaceAlt,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: radius.sm,
  },
  iconBtnText: {
    color: colors.text,
    fontSize: 12,
    fontWeight: '600',
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
  mtSm: {
    marginTop: spacing.xs,
  },
  subFolderSection: {
    padding: spacing.md,
  },
  sectionHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: spacing.sm,
  },
  sectionTitle: {
    color: colors.textMuted,
    fontSize: 13,
    fontWeight: '600',
  },
  addFolderText: {
    color: colors.primary,
    fontSize: 13,
    fontWeight: '600',
  },
  addFolderBtn: {
    alignSelf: 'flex-start',
    backgroundColor: colors.surfaceAlt,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
    borderRadius: radius.sm,
  },
  addFolderBtnText: {
    color: colors.primary,
    fontSize: 13,
    fontWeight: '600',
  },
  folderGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
  },
  folderCard: {
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: radius.md,
    padding: spacing.sm,
    width: '30%',
    alignItems: 'center',
  },
  folderIcon: {
    fontSize: 24,
    marginBottom: 4,
  },
  folderName: {
    color: colors.text,
    fontSize: 12,
    fontWeight: '500',
  },
  assetCell: {
    width: '33.33%',
    aspectRatio: 1,
    padding: 2,
  },
  assetSelected: {
    opacity: 0.6,
  },
  photoPlaceholder: {
    flex: 1,
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: radius.sm,
    justifyContent: 'center',
    alignItems: 'center',
    overflow: 'hidden',
  },
  thumbnail: {
    ...StyleSheet.absoluteFillObject,
  },
  photoIcon: {
    fontSize: 24,
  },
  photoPlaceholderContent: {
    alignItems: 'center',
    gap: 4,
  },
  photoPlaceholderText: {
    color: colors.textMuted,
    fontSize: 10,
    fontWeight: '600',
  },
  photoNameBackdrop: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    paddingHorizontal: 4,
    paddingVertical: 3,
    backgroundColor: 'rgba(0, 0, 0, 0.55)',
  },
  photoName: {
    color: '#FFFFFF',
    fontSize: 10,
    textAlign: 'center',
  },
  checkBadge: {
    position: 'absolute',
    top: 6,
    right: 6,
    backgroundColor: colors.primary,
    width: 20,
    height: 20,
    borderRadius: 10,
    justifyContent: 'center',
    alignItems: 'center',
  },
  checkText: {
    color: colors.primaryText,
    fontWeight: '700',
    fontSize: 12,
  },
  multiActionBar: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    backgroundColor: colors.surface,
    borderTopWidth: 1,
    borderTopColor: colors.border,
    padding: spacing.md,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: spacing.xs,
  },
  folderActionBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.sm,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
    backgroundColor: colors.surface,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  folderActionTitle: {
    flex: 1,
    minWidth: 0,
    color: colors.text,
    fontSize: 13,
    fontWeight: '600',
  },
  folderActionButtons: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    flexShrink: 0,
  },
  folderActionButton: {
    paddingHorizontal: 8,
    paddingVertical: 5,
    borderRadius: radius.sm,
    backgroundColor: colors.surfaceAlt,
  },
  folderActionText: {
    color: colors.text,
    fontSize: 11,
    fontWeight: '600',
  },
  folderDeleteButton: {
    backgroundColor: 'rgba(248, 113, 113, 0.15)',
  },
  folderDeleteText: {
    color: colors.danger,
    fontSize: 11,
    fontWeight: '600',
  },
  multiCount: {
    color: colors.text,
    fontSize: 13,
    fontWeight: '600',
  },
  emptyFolderBtn: {
    marginTop: spacing.md,
  },
  multiBtns: {
    flex: 1,
    flexDirection: 'row',
    justifyContent: 'flex-end',
    flexWrap: 'wrap',
    gap: spacing.xs,
  },
  multiBtn: {
    backgroundColor: colors.primary,
    paddingHorizontal: 10,
    paddingVertical: 8,
    borderRadius: radius.sm,
  },
  multiBtnText: {
    color: colors.primaryText,
    fontWeight: '600',
    fontSize: 13,
  },
  multiDeleteBtn: {
    backgroundColor: 'rgba(248, 113, 113, 0.2)',
  },
  multiDeleteText: {
    color: colors.danger,
    fontSize: 13,
    fontWeight: '600',
  },
  cancelBtn: {
    backgroundColor: colors.surfaceAlt,
  },
  cancelBtnText: {
    color: colors.text,
    fontSize: 13,
  },
  fab: {
    position: 'absolute',
    bottom: 24,
    right: 24,
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: colors.primary,
    justifyContent: 'center',
    alignItems: 'center',
    elevation: 4,
  },
  fabText: {
    color: colors.primaryText,
    fontSize: 32,
    fontWeight: '400',
    marginTop: -2,
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.6)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: spacing.lg,
  },
  modalCard: {
    width: '100%',
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: radius.md,
    padding: spacing.lg,
  },
  modalSub: {
    marginTop: spacing.xs,
  },
  modalInput: {
    backgroundColor: colors.surfaceAlt,
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: radius.sm,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    color: colors.text,
    marginTop: spacing.md,
    marginBottom: spacing.lg,
  },
  modalActions: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    gap: spacing.sm,
  },
  modalCancelBtn: {
    paddingHorizontal: 16,
    paddingVertical: 10,
  },
  modalCancelText: {
    color: colors.textMuted,
  },
  modalConfirmBtn: {
    backgroundColor: colors.primary,
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: radius.sm,
  },
  modalConfirmText: {
    color: colors.primaryText,
    fontWeight: '600',
  },
  disabledBtn: {
    opacity: 0.6,
  },
});
