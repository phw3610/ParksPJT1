import {
  authenticate,
  getSpaceRole,
  HttpError,
  json,
  parseJson,
  requireString,
  withErrorHandling,
} from "../_shared/common.ts";

Deno.serve(
  withErrorHandling(async (req) => {
    if (req.method !== "POST") {
      throw new HttpError(405, "UNSUPPORTED", "POST 요청만 지원합니다.");
    }
    const { admin, user } = await authenticate(req);
    const body = await parseJson(req);
    const assetId = requireString(body.assetId, "assetId");
    const errorCode = requireString(body.errorCode, "errorCode", {
      maxLength: 200,
    });
    const { data: asset, error } = await admin
      .from("assets")
      .select("id,space_id,uploader_id")
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
    const allowed = role === "owner" || role === "admin" ||
      (role === "member" && asset.uploader_id === user.id);
    if (!allowed) {
      throw new HttpError(
        403,
        "FORBIDDEN",
        "이 업로드를 변경할 권한이 없습니다.",
      );
    }

    const { error: updateError } = await admin
      .from("assets")
      .update({ status: "failed", error_code: errorCode })
      .eq("id", asset.id)
      .in("status", ["pending", "uploading", "failed"]);
    if (updateError) {
      throw new HttpError(
        500,
        "UNKNOWN",
        "업로드 실패 상태를 저장하지 못했습니다.",
      );
    }
    return json({ status: "failed" });
  }),
);
