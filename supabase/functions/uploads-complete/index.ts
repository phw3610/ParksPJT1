import {
  authenticate,
  getActiveConnection,
  getSpaceRole,
  HttpError,
  json,
  parseJson,
  requireString,
  withErrorHandling,
} from "../_shared/common.ts";
import { GoogleDriveProvider } from "../_shared/googleDrive.ts";
import { getAccessToken } from "../_shared/tokens.ts";

Deno.serve(
  withErrorHandling(async (req) => {
    if (req.method !== "POST") {
      throw new HttpError(405, "UNSUPPORTED", "POST 요청만 지원합니다.");
    }
    const { admin, user } = await authenticate(req);
    const body = await parseJson(req);
    const assetId = requireString(body.assetId, "assetId");
    const remoteFileId = requireString(body.remoteFileId, "remoteFileId");
    if (typeof body.thumbUploaded !== "boolean") {
      throw new HttpError(
        400,
        "UNKNOWN",
        "thumbUploaded 값이 올바르지 않습니다.",
      );
    }

    const { data: asset, error } = await admin
      .from("assets")
      .select("*")
      .eq("id", assetId)
      .is("deleted_at", null)
      .maybeSingle();
    if (error) {
      throw new HttpError(500, "UNKNOWN", "에셋을 조회하지 못했습니다.");
    }
    if (!asset) {
      throw new HttpError(404, "NOT_FOUND", "에셋을 찾을 수 없습니다.");
    }
    const role = await getSpaceRole(admin, asset.space_id, user.id);
    const canComplete = role === "owner" || role === "admin" ||
      (role === "member" && asset.uploader_id === user.id);
    if (!canComplete) {
      throw new HttpError(
        403,
        "FORBIDDEN",
        "이 업로드를 완료할 권한이 없습니다.",
      );
    }

    const connection = await getActiveConnection(admin, asset.space_id);
    const drive = new GoogleDriveProvider({
      getAccessToken: async () => await getAccessToken(admin, connection),
    });
    const remote = await drive.getFile(remoteFileId, "id,name,size,trashed");
    if (
      remote.trashed || Number(remote.size ?? -1) !== Number(asset.byte_size)
    ) {
      throw new HttpError(
        409,
        "UNKNOWN",
        "Drive의 업로드 파일 크기가 요청과 일치하지 않습니다.",
      );
    }
    if (remote.name !== `${asset.id}_${asset.original_name}`) {
      throw new HttpError(
        409,
        "UNKNOWN",
        "Drive의 업로드 파일 이름이 요청과 일치하지 않습니다.",
      );
    }

    const { error: updateError } = await admin
      .from("assets")
      .update({
        remote_file_id: remoteFileId,
        thumb_path: body.thumbUploaded
          ? `${asset.space_id}/${asset.id}.jpg`
          : null,
        status: "ready",
        error_code: null,
      })
      .eq("id", asset.id)
      .is("deleted_at", null);
    if (updateError) {
      throw new HttpError(
        500,
        "UNKNOWN",
        "업로드 완료 상태를 저장하지 못했습니다.",
      );
    }
    return json({ status: "ready" });
  }),
);
