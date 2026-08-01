import type { SupabaseClient } from "jsr:@supabase/supabase-js@2";

import {
  assertSpaceRole,
  authenticate,
  getActiveConnection,
  HttpError,
  json,
  optionalString,
  parseJson,
  requireNumber,
  requireString,
  withErrorHandling,
} from "../_shared/common.ts";
import { GoogleDriveProvider } from "../_shared/googleDrive.ts";
import { getAccessToken } from "../_shared/tokens.ts";

interface FolderRow {
  id: string;
  space_id: string;
  parent_id: string | null;
  name: string;
  path: string;
  drive_folder_id: string | null;
  deleted_at: string | null;
}

Deno.serve(
  withErrorHandling(async (req) => {
    if (req.method !== "POST") {
      throw new HttpError(405, "UNSUPPORTED", "POST 요청만 지원합니다.");
    }
    const { admin, user } = await authenticate(req);
    const body = await parseJson(req);
    const spaceId = requireString(body.spaceId, "spaceId");
    const folderId = optionalString(body.folderId, "folderId") ?? null;
    const originalName = requireString(body.originalName, "originalName", {
      maxLength: 500,
    });
    const mimeType = requireString(body.mimeType, "mimeType", {
      maxLength: 255,
    });
    const byteSize = requireNumber(body.byteSize, "byteSize", 1);
    const kind = requireString(body.kind, "kind");
    if (kind !== "image" && kind !== "video") {
      throw new HttpError(
        400,
        "UNKNOWN",
        "kind는 image 또는 video여야 합니다.",
      );
    }
    const capturedAt = optionalString(body.capturedAt, "capturedAt") ?? null;
    if (capturedAt && Number.isNaN(Date.parse(capturedAt))) {
      throw new HttpError(
        400,
        "UNKNOWN",
        "capturedAt 값이 올바른 날짜가 아닙니다.",
      );
    }
    const width = body.width === undefined
      ? null
      : requireNumber(body.width, "width", 1);
    const height = body.height === undefined
      ? null
      : requireNumber(body.height, "height", 1);
    const durationMs = body.durationMs === undefined
      ? null
      : requireNumber(body.durationMs, "durationMs");
    const contentHash = optionalString(body.contentHash, "contentHash") ?? null;

    await assertSpaceRole(admin, spaceId, user.id, [
      "owner",
      "admin",
      "member",
    ]);
    const connection = await getActiveConnection(admin, spaceId);
    if (!connection.root_folder_id) {
      throw new HttpError(
        409,
        "REVOKED",
        "Google Drive 루트 폴더 연결 정보가 없습니다.",
      );
    }
    const drive = new GoogleDriveProvider({
      getAccessToken: async () => await getAccessToken(admin, connection),
    });
    const folder = folderId ? await getFolder(admin, folderId, spaceId) : null;
    const parentFolderId = folder
      ? await ensureDriveFolder(admin, drive, folder, connection.root_folder_id)
      : connection.root_folder_id;

    const assetId = crypto.randomUUID();
    const session = await drive.createUploadSession({
      assetId,
      parentFolderId,
      originalName,
      mimeType,
      byteSize,
    });
    const remotePath = `${
      folder?.path ? `${folder.path}/` : ""
    }${assetId}_${originalName}`;
    const { error: insertError } = await admin.from("assets").insert({
      id: assetId,
      space_id: spaceId,
      folder_id: folderId,
      uploader_id: user.id,
      kind,
      original_name: originalName,
      mime_type: mimeType,
      byte_size: byteSize,
      width,
      height,
      duration_ms: durationMs,
      captured_at: capturedAt,
      storage_provider: connection.provider,
      remote_path: remotePath,
      content_hash: contentHash,
      status: "uploading",
    });
    if (insertError) {
      throw new HttpError(500, "UNKNOWN", "업로드 에셋을 생성하지 못했습니다.");
    }

    return json({ assetId, provider: connection.provider, ...session });
  }),
);

async function getFolder(
  admin: SupabaseClient,
  folderId: string,
  spaceId: string,
): Promise<FolderRow> {
  const { data, error } = await admin
    .from("folders")
    .select("id,space_id,parent_id,name,path,drive_folder_id,deleted_at")
    .eq("id", folderId)
    .eq("space_id", spaceId)
    .is("deleted_at", null)
    .maybeSingle();
  if (error) {
    throw new HttpError(500, "UNKNOWN", "대상 폴더를 조회하지 못했습니다.");
  }
  if (!data) {
    throw new HttpError(404, "NOT_FOUND", "대상 폴더를 찾을 수 없습니다.");
  }
  return data as FolderRow;
}

async function ensureDriveFolder(
  admin: SupabaseClient,
  drive: GoogleDriveProvider,
  target: FolderRow,
  rootFolderId: string,
): Promise<string> {
  if (target.drive_folder_id) return target.drive_folder_id;
  const chain: FolderRow[] = [target];
  let current = target;
  while (current.parent_id) {
    current = await getFolder(admin, current.parent_id, target.space_id);
    chain.push(current);
  }
  chain.reverse();

  let parentDriveId = rootFolderId;
  for (const folder of chain) {
    if (folder.drive_folder_id) {
      parentDriveId = folder.drive_folder_id;
      continue;
    }
    const remote = await drive.createFolder(parentDriveId, folder.name);
    const { data, error } = await admin
      .from("folders")
      .update({ drive_folder_id: remote.fileId })
      .eq("id", folder.id)
      .is("drive_folder_id", null)
      .select("drive_folder_id")
      .maybeSingle();
    if (error) {
      throw new HttpError(
        500,
        "UNKNOWN",
        "Drive 폴더 식별자를 저장하지 못했습니다.",
      );
    }
    if (!data?.drive_folder_id) {
      const refreshed = await getFolder(admin, folder.id, target.space_id);
      if (!refreshed.drive_folder_id) {
        throw new HttpError(
          500,
          "UNKNOWN",
          "Drive 폴더 식별자를 확인하지 못했습니다.",
        );
      }
      // A concurrent request won the DB race. Trash our duplicate folder.
      await drive.delete(remote);
      parentDriveId = refreshed.drive_folder_id;
    } else {
      parentDriveId = data.drive_folder_id;
    }
  }
  return parentDriveId;
}
