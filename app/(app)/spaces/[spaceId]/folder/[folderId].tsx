import { useLocalSearchParams } from 'expo-router';
import React from 'react';

import { FolderBrowser } from '@/components/FolderBrowser';

export default function SubFolderScreen() {
  const { spaceId, folderId } = useLocalSearchParams<{ spaceId: string; folderId: string }>();
  return <FolderBrowser spaceId={spaceId!} folderId={folderId!} />;
}
