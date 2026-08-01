/**
 * DB 스키마 타입.
 * 마이그레이션을 바꾼 뒤에는 아래 명령으로 재생성한다:
 *   npx supabase gen types typescript --project-id <ref> > src/lib/database.types.ts
 * 지금은 supabase/migrations/0001_init.sql과 손으로 맞춰 둔 버전이다.
 */

export type MemberRole = 'owner' | 'admin' | 'member' | 'viewer';
export type StorageKind = 'google_drive' | 'webdav' | 's3_compatible' | 'naver_mybox';
export type AssetStatus = 'pending' | 'uploading' | 'ready' | 'failed' | 'trashed' | 'orphaned';
export type AssetKind = 'image' | 'video';

export interface Profile {
  id: string;
  display_name: string;
  avatar_url: string | null;
  created_at: string;
}

export interface Space {
  id: string;
  name: string;
  owner_id: string;
  created_at: string;
  deleted_at: string | null;
}

export interface SpaceMember {
  space_id: string;
  user_id: string;
  role: MemberRole;
  joined_at: string;
}

export interface Folder {
  id: string;
  space_id: string;
  parent_id: string | null;
  name: string;
  path: string;
  depth: number;
  drive_folder_id: string | null;
  cover_asset_id: string | null;
  created_by: string;
  created_at: string;
  deleted_at: string | null;
}

export interface Asset {
  id: string;
  space_id: string;
  folder_id: string | null;
  uploader_id: string;
  kind: AssetKind;
  original_name: string;
  mime_type: string;
  byte_size: number;
  width: number | null;
  height: number | null;
  duration_ms: number | null;
  captured_at: string | null;
  storage_provider: StorageKind;
  remote_file_id: string | null;
  remote_path: string;
  thumb_path: string | null;
  content_hash: string | null;
  status: AssetStatus;
  error_code: string | null;
  created_at: string;
  deleted_at: string | null;
}

/** 클라이언트가 볼 수 있는 컬럼만. vault_secret_id는 컬럼 권한으로 차단되어 있다. */
export interface StorageConnection {
  id: string;
  space_id: string;
  provider: StorageKind;
  connected_by: string;
  account_label: string | null;
  root_folder_id: string | null;
  is_active: boolean;
  last_error: string | null;
  last_verified_at: string | null;
  created_at: string;
}

/** token_hash는 컬럼 권한으로 차단되어 있다. */
export interface Invite {
  id: string;
  space_id: string;
  role: MemberRole;
  created_by: string;
  expires_at: string;
  max_uses: number;
  used_count: number;
  revoked_at: string | null;
  created_at: string;
}

type Table<Row, Insert = Partial<Row>, Update = Partial<Row>> = {
  Row: Row;
  Insert: Insert;
  Update: Update;
  Relationships: [];
};

export interface Database {
  public: {
    Tables: {
      profiles: Table<Profile>;
      spaces: Table<Space>;
      space_members: Table<SpaceMember>;
      folders: Table<Folder>;
      assets: Table<Asset>;
      storage_connections: Table<StorageConnection>;
      invites: Table<Invite>;
      devices: Table<{
        id: string;
        user_id: string;
        push_token: string;
        platform: 'ios' | 'android';
        last_seen_at: string;
      }>;
    };
    Views: Record<string, never>;
    Functions: {
      accept_invite: { Args: { p_token: string }; Returns: string };
      preview_invite: {
        Args: { p_token: string };
        Returns: {
          space_name: string;
          inviter_name: string;
          member_count: number;
          asset_count: number;
        }[];
      };
    };
    Enums: {
      member_role: MemberRole;
      storage_kind: StorageKind;
      asset_status: AssetStatus;
      asset_kind: AssetKind;
    };
    CompositeTypes: Record<string, never>;
  };
}
