import * as SQLite from 'expo-sqlite';

export type UploadQueueStatus = 'pending' | 'uploading' | 'done' | 'failed' | 'paused';
export type UploadSource = 'manual' | 'auto';

export interface UploadQueueItem {
  id: string;
  space_id: string;
  folder_id: string | null;
  local_id: string | null;
  file_uri: string;
  original_name: string;
  mime_type: string;
  byte_size: number;
  captured_at: number | null;
  quick_hash: string | null;
  asset_id: string | null;
  upload_url: string | null;
  bytes_sent: number;
  status: UploadQueueStatus;
  attempts: number;
  last_error: string | null;
  source: UploadSource;
  created_at: number;
}

let dbInstance: SQLite.SQLiteDatabase | null = null;

export async function getDatabase(): Promise<SQLite.SQLiteDatabase> {
  if (dbInstance) return dbInstance;
  dbInstance = await SQLite.openDatabaseAsync('upload_queue.db');
  await dbInstance.execAsync(`
    PRAGMA journal_mode = WAL;
    CREATE TABLE IF NOT EXISTS upload_queue (
      id            TEXT PRIMARY KEY,
      space_id      TEXT NOT NULL,
      folder_id     TEXT,
      local_id      TEXT,
      file_uri      TEXT NOT NULL,
      original_name TEXT NOT NULL,
      mime_type     TEXT NOT NULL,
      byte_size     INTEGER NOT NULL,
      captured_at   INTEGER,
      quick_hash    TEXT,
      asset_id      TEXT,
      upload_url    TEXT,
      bytes_sent    INTEGER NOT NULL DEFAULT 0,
      status        TEXT NOT NULL DEFAULT 'pending',
      attempts      INTEGER NOT NULL DEFAULT 0,
      last_error    TEXT,
      source        TEXT NOT NULL DEFAULT 'manual',
      created_at    INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_queue_status ON upload_queue (status, created_at);
    CREATE UNIQUE INDEX IF NOT EXISTS idx_queue_local ON upload_queue (space_id, local_id)
      WHERE local_id IS NOT NULL;

    CREATE TABLE IF NOT EXISTS auto_upload_config (
      space_id          TEXT PRIMARY KEY,
      enabled           INTEGER NOT NULL DEFAULT 0,
      album_id          TEXT,
      target_folder_id  TEXT,
      include_videos    INTEGER NOT NULL DEFAULT 0,
      wifi_only         INTEGER NOT NULL DEFAULT 1,
      min_captured_at   INTEGER,
      last_processed_at INTEGER NOT NULL DEFAULT 0,
      last_run_at       INTEGER,
      last_run_count    INTEGER
    );
  `);
  return dbInstance;
}

export async function enqueueItem(
  item: Omit<UploadQueueItem, 'id' | 'created_at' | 'status' | 'attempts' | 'bytes_sent' | 'asset_id' | 'upload_url' | 'last_error'>
): Promise<UploadQueueItem> {
  const db = await getDatabase();
  const id = `item_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  const createdAt = Date.now();

  const newItem: UploadQueueItem = {
    id,
    space_id: item.space_id,
    folder_id: item.folder_id,
    local_id: item.local_id,
    file_uri: item.file_uri,
    original_name: item.original_name,
    mime_type: item.mime_type,
    byte_size: item.byte_size,
    captured_at: item.captured_at,
    quick_hash: item.quick_hash,
    asset_id: null,
    upload_url: null,
    bytes_sent: 0,
    status: 'pending',
    attempts: 0,
    last_error: null,
    source: item.source,
    created_at: createdAt,
  };

  await db.runAsync(
    `INSERT INTO upload_queue
      (id, space_id, folder_id, local_id, file_uri, original_name, mime_type, byte_size, captured_at, quick_hash, status, source, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?)`,
    [
      newItem.id,
      newItem.space_id,
      newItem.folder_id,
      newItem.local_id,
      newItem.file_uri,
      newItem.original_name,
      newItem.mime_type,
      newItem.byte_size,
      newItem.captured_at,
      newItem.quick_hash,
      newItem.source,
      newItem.created_at,
    ]
  );

  return newItem;
}

export async function getPendingItems(limit = 10): Promise<UploadQueueItem[]> {
  const db = await getDatabase();
  const rows = await db.getAllAsync<UploadQueueItem>(
    `SELECT * FROM upload_queue WHERE status = 'pending' ORDER BY created_at ASC LIMIT ?`,
    [limit]
  );
  return rows;
}

export async function getAllItemsForSpace(spaceId: string): Promise<UploadQueueItem[]> {
  const db = await getDatabase();
  const rows = await db.getAllAsync<UploadQueueItem>(
    `SELECT * FROM upload_queue WHERE space_id = ? ORDER BY created_at DESC`,
    [spaceId]
  );
  return rows;
}

export async function updateItemStatus(
  id: string,
  status: UploadQueueStatus,
  updates?: Partial<Pick<UploadQueueItem, 'asset_id' | 'upload_url' | 'bytes_sent' | 'attempts' | 'last_error'>>
): Promise<void> {
  const db = await getDatabase();
  const setClauses: string[] = ['status = ?'];
  const params: unknown[] = [status];

  if (updates?.asset_id !== undefined) {
    setClauses.push('asset_id = ?');
    params.push(updates.asset_id);
  }
  if (updates?.upload_url !== undefined) {
    setClauses.push('upload_url = ?');
    params.push(updates.upload_url);
  }
  if (updates?.bytes_sent !== undefined) {
    setClauses.push('bytes_sent = ?');
    params.push(updates.bytes_sent);
  }
  if (updates?.attempts !== undefined) {
    setClauses.push('attempts = ?');
    params.push(updates.attempts);
  }
  if (updates?.last_error !== undefined) {
    setClauses.push('last_error = ?');
    params.push(updates.last_error);
  }

  params.push(id);

  await db.runAsync(`UPDATE upload_queue SET ${setClauses.join(', ')} WHERE id = ?`, params as any[]);
}

export async function resetUploadingToPending(): Promise<void> {
  const db = await getDatabase();
  await db.runAsync(`UPDATE upload_queue SET status = 'pending' WHERE status = 'uploading'`);
}

export async function deleteQueueItem(id: string): Promise<void> {
  const db = await getDatabase();
  await db.runAsync(`DELETE FROM upload_queue WHERE id = ?`, [id]);
}

export async function clearCompletedItems(spaceId: string): Promise<void> {
  const db = await getDatabase();
  await db.runAsync(`DELETE FROM upload_queue WHERE space_id = ? AND status = 'done'`, [spaceId]);
}
