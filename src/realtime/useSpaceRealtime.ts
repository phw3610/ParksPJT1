import { useEffect, useRef } from 'react';

import { supabase } from '@/lib/supabase';

interface UseSpaceRealtimeOptions {
  spaceId: string;
  onAssetsChange?: () => void;
  onFoldersChange?: () => void;
  onMembersChange?: () => void;
}

export function useSpaceRealtime({
  spaceId,
  onAssetsChange,
  onFoldersChange,
  onMembersChange,
}: UseSpaceRealtimeOptions): void {
  const handlersRef = useRef({ onAssetsChange, onFoldersChange, onMembersChange });
  handlersRef.current = { onAssetsChange, onFoldersChange, onMembersChange };

  useEffect(() => {
    if (!spaceId) return;

    const filter = `space_id=eq.${spaceId}`;
    const channel = supabase
      .channel(`space:${spaceId}`)
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'assets', filter },
        () => handlersRef.current.onAssetsChange?.(),
      )
      .on(
        'postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'assets', filter },
        () => handlersRef.current.onAssetsChange?.(),
      )
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'folders', filter },
        () => handlersRef.current.onFoldersChange?.(),
      )
      .on(
        'postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'folders', filter },
        () => handlersRef.current.onFoldersChange?.(),
      )
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'space_members', filter },
        () => handlersRef.current.onMembersChange?.(),
      )
      .on(
        'postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'space_members', filter },
        () => handlersRef.current.onMembersChange?.(),
      )
      .subscribe();

    // Postgres Changes cannot filter or apply RLS to DELETE events. Subscribing
    // here would expose membership primary keys across spaces, so removal is
    // detected by the next membership-backed screen refresh instead.
    return () => {
      void supabase.removeChannel(channel);
    };
  }, [spaceId]);
}
