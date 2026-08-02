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

/** 휴지통에서 되돌리기. Drive 휴지통에서도 함께 꺼낸다. */
Deno.serve(
  withErrorHandling(async (req) => {
    if (req.method !== "POST") {
      throw new HttpError(405, "UNSUPPORTED", "POST 요청만 지원합니다.");
    }
    const { admin, user } = await authenticate(req);
    const body = await parseJson(req);
    const assetIds = requireStringArray(body.assetIds, "assetIds", 100);

    const { data: assets, error } = await admin
      .from("assets")
      .select("id,space_id,uploader_id,remote_file_id,remote_path,deleted_at")
      .in("id", assetIds);
    if (error) {
      throw new HttpError(500, "UNKNOWN", "되돌릴 에셋을 조회하지 못했습니다.");
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
          "일부 에셋을 되돌릴 권한이 없습니다.",
        );
      }
    }

    const providers = new Map<string, GoogleDriveProvider>();
    const restored: string[] = [];
    const missing: string[] = [];

    for (const asset of assets) {
      if (!asset.deleted_at) continue;

      if (asset.remote_file_id) {
        let drive = providers.get(asset.space_id);
        if (!drive) {
          const connection = await getActiveConnection(admin, asset.space_id);
          drive = new GoogleDriveProvider({
            getAccessToken: async () => await getAccessToken(admin, connection),
          });
          providers.set(asset.space_id, drive);
        }
        try {
          await drive.restore({
            fileId: asset.remote_file_id,
            path: asset.remote_path,
          });
        } catch (error) {
          // Drive에서 이미 완전히 지워졌으면 되돌려도 볼 수 없다. 앱 상태도 바꾸지 않는다.
          if (error instanceof DriveError && error.code === "NOT_FOUND") {
            await admin.from("assets").update({
              status: "orphaned",
              error_code: "NOT_FOUND",
            }).eq("id", asset.id);
            missing.push(asset.id);
            continue;
          }
          throw error;
        }
      }

      const { error: updateError } = await admin
        .from("assets")
        .update({
          deleted_at: null,
          status: "ready",
          error_code: null,
        })
        .eq("id", asset.id)
        .not("deleted_at", "is", null);
      if (updateError) {
        throw new HttpError(500, "UNKNOWN", "에셋을 되돌리지 못했습니다.");
      }
      restored.push(asset.id);
    }

    return json({ ok: true, restored, missing });
  }),
);
