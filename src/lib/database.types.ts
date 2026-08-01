/**
 * supabase/migrations/0001_init.sql과 일치하는 DB 타입.
 * 실제 프로젝트가 생기면 `supabase gen types typescript` 결과와 다시 대조한다.
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

/** 클라이언트가 볼 수 있는 컬럼만. vault_secret_id는 컬럼 권한으로 차단된다. */
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

/** token_hash는 컬럼 권한으로 차단된다. */
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

interface StorageConnectionRow extends StorageConnection {
  vault_secret_id: string;
}

interface InviteRow extends Invite {
  token_hash: string;
}

interface DeviceRow {
  id: string;
  user_id: string;
  push_token: string;
  platform: 'ios' | 'android';
  last_seen_at: string;
}

interface CommentRow {
  id: string;
  space_id: string;
  asset_id: string;
  author_id: string;
  body: string;
  created_at: string;
  deleted_at: string | null;
}

interface ReactionRow {
  space_id: string;
  asset_id: string;
  user_id: string;
  emoji: string;
  created_at: string;
}

/** 내부 전용. RLS 정책과 클라이언트 권한이 없으므로 앱에서 사용하면 안 된다. */
interface NotificationBatchRow {
  id: string;
  space_id: string;
  asset_count: number;
  first_asset_at: string;
  last_asset_at: string;
  scheduled_for: string;
  sent_at: string | null;
  delivery_error: string | null;
  created_at: string;
  updated_at: string;
}

type Table<Row, Insert, Update> = {
  Row: Row;
  Insert: Insert;
  Update: Update;
  Relationships: [];
};

export interface Database {
  public: {
    Tables: {
      profiles: Table<
        Profile,
        { id: string; display_name: string; avatar_url?: string | null; created_at?: string },
        { id?: string; display_name?: string; avatar_url?: string | null; created_at?: string }
      >;
      spaces: Table<
        Space,
        { id?: string; name: string; owner_id: string; created_at?: string; deleted_at?: string | null },
        { id?: string; name?: string; owner_id?: string; created_at?: string; deleted_at?: string | null }
      >;
      space_members: Table<
        SpaceMember,
        { space_id: string; user_id: string; role?: MemberRole; joined_at?: string },
        { space_id?: string; user_id?: string; role?: MemberRole; joined_at?: string }
      >;
      folders: Table<
        Folder,
        {
          id?: string;
          space_id: string;
          parent_id?: string | null;
          name: string;
          path: string;
          depth?: number;
          drive_folder_id?: string | null;
          cover_asset_id?: string | null;
          created_by: string;
          created_at?: string;
          deleted_at?: string | null;
        },
        {
          id?: string;
          space_id?: string;
          parent_id?: string | null;
          name?: string;
          path?: string;
          depth?: number;
          drive_folder_id?: string | null;
          cover_asset_id?: string | null;
          created_by?: string;
          created_at?: string;
          deleted_at?: string | null;
        }
      >;
      assets: Table<
        Asset,
        {
          id?: string;
          space_id: string;
          folder_id?: string | null;
          uploader_id: string;
          kind: AssetKind;
          original_name: string;
          mime_type: string;
          byte_size: number;
          width?: number | null;
          height?: number | null;
          duration_ms?: number | null;
          captured_at?: string | null;
          storage_provider: StorageKind;
          remote_file_id?: string | null;
          remote_path: string;
          thumb_path?: string | null;
          content_hash?: string | null;
          status?: AssetStatus;
          error_code?: string | null;
          created_at?: string;
          deleted_at?: string | null;
        },
        {
          id?: string;
          space_id?: string;
          folder_id?: string | null;
          uploader_id?: string;
          kind?: AssetKind;
          original_name?: string;
          mime_type?: string;
          byte_size?: number;
          width?: number | null;
          height?: number | null;
          duration_ms?: number | null;
          captured_at?: string | null;
          storage_provider?: StorageKind;
          remote_file_id?: string | null;
          remote_path?: string;
          thumb_path?: string | null;
          content_hash?: string | null;
          status?: AssetStatus;
          error_code?: string | null;
          created_at?: string;
          deleted_at?: string | null;
        }
      >;
      storage_connections: Table<
        StorageConnectionRow,
        {
          id?: string;
          space_id: string;
          provider: StorageKind;
          connected_by: string;
          account_label?: string | null;
          root_folder_id?: string | null;
          vault_secret_id: string;
          is_active?: boolean;
          last_error?: string | null;
          last_verified_at?: string | null;
          created_at?: string;
        },
        {
          id?: string;
          space_id?: string;
          provider?: StorageKind;
          connected_by?: string;
          account_label?: string | null;
          root_folder_id?: string | null;
          vault_secret_id?: string;
          is_active?: boolean;
          last_error?: string | null;
          last_verified_at?: string | null;
          created_at?: string;
        }
      >;
      invites: Table<
        InviteRow,
        {
          id?: string;
          space_id: string;
          token_hash: string;
          role?: MemberRole;
          created_by: string;
          expires_at: string;
          max_uses?: number;
          used_count?: number;
          revoked_at?: string | null;
          created_at?: string;
        },
        {
          id?: string;
          space_id?: string;
          token_hash?: string;
          role?: MemberRole;
          created_by?: string;
          expires_at?: string;
          max_uses?: number;
          used_count?: number;
          revoked_at?: string | null;
          created_at?: string;
        }
      >;
      devices: Table<
        DeviceRow,
        { id?: string; user_id: string; push_token: string; platform: 'ios' | 'android'; last_seen_at?: string },
        { id?: string; user_id?: string; push_token?: string; platform?: 'ios' | 'android'; last_seen_at?: string }
      >;
      comments: Table<
        CommentRow,
        {
          id?: string;
          space_id: string;
          asset_id: string;
          author_id: string;
          body: string;
          created_at?: string;
          deleted_at?: string | null;
        },
        {
          id?: string;
          space_id?: string;
          asset_id?: string;
          author_id?: string;
          body?: string;
          created_at?: string;
          deleted_at?: string | null;
        }
      >;
      reactions: Table<
        ReactionRow,
        {
          space_id: string;
          asset_id: string;
          user_id: string;
          emoji?: string;
          created_at?: string;
        },
        {
          space_id?: string;
          asset_id?: string;
          user_id?: string;
          emoji?: string;
          created_at?: string;
        }
      >;
      /** 내부 전용. 클라이언트 사용 금지. */
      notification_batches: Table<
        NotificationBatchRow,
        {
          id?: string;
          space_id: string;
          asset_count?: number;
          first_asset_at?: string;
          last_asset_at?: string;
          scheduled_for?: string;
          sent_at?: string | null;
          delivery_error?: string | null;
          created_at?: string;
          updated_at?: string;
        },
        {
          id?: string;
          space_id?: string;
          asset_count?: number;
          first_asset_at?: string;
          last_asset_at?: string;
          scheduled_for?: string;
          sent_at?: string | null;
          delivery_error?: string | null;
          created_at?: string;
          updated_at?: string;
        }
      >;
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
      is_space_member: { Args: { p_space: string }; Returns: boolean };
      space_role: { Args: { p_space: string }; Returns: MemberRole };
      can_manage: { Args: { p_space: string }; Returns: boolean };
      can_write: { Args: { p_space: string }; Returns: boolean };
      /** service_role 전용 */
      create_vault_secret: { Args: { p_secret: string }; Returns: string };
      /** service_role 전용 */
      read_vault_secret: { Args: { p_secret_id: string }; Returns: string };
      /** service_role 전용 */
      delete_vault_secret: { Args: { p_secret_id: string }; Returns: undefined };
      /** service_role 전용 */
      enqueue_notification_batch: {
        Args: { p_space_id: string };
        Returns: NotificationBatchRow;
      };
      /** service_role 전용 */
      claim_due_notification_batches: {
        Args: { p_limit?: number };
        Returns: NotificationBatchRow[];
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
