import { useLocalSearchParams } from 'expo-router';
import React from 'react';

import { FolderBrowser } from '@/components/FolderBrowser';

export default function SpaceHomeScreen() {
  const { spaceId } = useLocalSearchParams<{ spaceId: string }>();
  return <FolderBrowser spaceId={spaceId!} folderId={null} />;
}
