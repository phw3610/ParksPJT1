import {
  authenticate,
  getActiveConnection,
  getSpaceRole,
  HttpError,
  json,
  parseJson,
  requireStringArray,
  withErrorHandling,
} from "../_shared/common.ts";
import { DriveError, GoogleDriveProvider } from "../_shared/googleDrive.ts";
import { getAccessToken } from "../_shared/tokens.ts";

Deno.serve(
  withErrorHandling(async (req) => {
    if (req.method !== "POST") {
      throw new HttpError(405, "UNSUPPORTED", "POST 요청만 지원합니다.");
    }
    const { admin, user } = await authenticate(req);
    const body = await parseJson(req);
    const assetIds = requireStringArray(body.assetIds, "assetIds", 100);
    const deleteRemote = body.deleteRemote !== false;
    const { data: assets, error } = await admin
      .from("assets")
      .select(
        "id,space_id,uploader_id,remote_file_id,remote_path,thumb_path,deleted_at",
      )
      .in("id", assetIds);
    if (error) {
      throw new HttpError(500, "UNKNOWN", "삭제할 에셋을 조회하지 못했습니다.");
    }
    if (!assets || assets.length !== assetIds.length) {
      throw new HttpError(404, "NOT_FOUND", "일부 에셋을 찾을 수 없습니다.");
    }

    const roles = new Map<string, string | null>();
    for (const asset of assets) {
      if (!roles.has(asset.space_id)) {
        roles.set(
          asset.space_id,
          await getSpaceRole(admin, asset.space_id, user.id),
        );
      }
      const role = roles.get(asset.space_id);
      const allowed = role === "owner" || role === "admin" ||
        (role === "member" && asset.uploader_id === user.id);
      if (!allowed) {
        throw new HttpError(
          403,
          "FORBIDDEN",
          "일부 에셋을 삭제할 권한이 없습니다.",
        );
      }
    }

    const providers = new Map<string, GoogleDriveProvider>();
    for (const asset of assets) {
      if (asset.deleted_at) continue;
      if (deleteRemote && asset.remote_file_id) {
        let drive = providers.get(asset.space_id);
        if (!drive) {
          const connection = await getActiveConnection(admin, asset.space_id);
          drive = new GoogleDriveProvider({
            getAccessToken: async () => await getAccessToken(admin, connection),
          });
          providers.set(asset.space_id, drive);
        }
        try {
          await drive.delete({
            fileId: asset.remote_file_id,
            path: asset.remote_path,
          });
        } catch (error) {
          // A missing remote file already satisfies the requested end state.
          if (!(error instanceof DriveError && error.code === "NOT_FOUND")) {
            throw error;
          }
        }
      }

      if (asset.thumb_path) {
        const { error: thumbError } = await admin.storage.from("thumbs").remove(
          [asset.thumb_path],
        );
        if (thumbError) {
          throw new HttpError(500, "UNKNOWN", "썸네일을 삭제하지 못했습니다.");
        }
      }
      const { error: updateError } = await admin
        .from("assets")
        .update({
          deleted_at: new Date().toISOString(),
          status: "trashed",
          thumb_path: null,
        })
        .eq("id", asset.id)
        .is("deleted_at", null);
      if (updateError) {
        throw new HttpError(
          500,
          "UNKNOWN",
          "에셋 삭제 상태를 저장하지 못했습니다.",
        );
      }
    }
    return json({ ok: true });
  }),
);
