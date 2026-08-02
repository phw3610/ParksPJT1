import {
  authenticate,
  getSpaceRole,
  HttpError,
  json,
  parseJson,
  requireStringArray,
  withErrorHandling,
} from "../_shared/common.ts";

/**
 * 휴지통에서 완전히 지운다. 앱의 메타데이터와 썸네일만 지우고
 * **Drive 원본은 Drive 휴지통에 그대로 둔다.**
 * 원본은 사용자 저장소의 것이고, 남의 Drive 파일을 앱이 되돌릴 수 없게 지우면 안 된다.
 * Drive 휴지통은 30일 뒤 자동 정리되며 그전까지는 Drive에서 직접 복구할 수 있다.
 */
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
      .select("id,space_id,uploader_id,thumb_path,deleted_at")
      .in("id", assetIds);
    if (error) {
      throw new HttpError(500, "UNKNOWN", "지울 에셋을 조회하지 못했습니다.");
    }
    if (!assets || assets.length !== assetIds.length) {
      throw new HttpError(404, "NOT_FOUND", "일부 에셋을 찾을 수 없습니다.");
    }

    const roles = new Map<string, string | null>();
    for (const asset of assets) {
      if (!asset.deleted_at) {
        throw new HttpError(
          400,
          "UNKNOWN",
          "휴지통에 있는 항목만 완전히 지울 수 있습니다.",
        );
      }
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
        throw new HttpError(403, "FORBIDDEN", "일부 에셋을 지울 권한이 없습니다.");
      }
    }

    const thumbPaths = assets
      .map((asset) => asset.thumb_path)
      .filter((path): path is string => Boolean(path));
    if (thumbPaths.length > 0) {
      const { error: thumbError } = await admin.storage
        .from("thumbs")
        .remove(thumbPaths);
      if (thumbError) {
        throw new HttpError(500, "UNKNOWN", "썸네일을 지우지 못했습니다.");
      }
    }

    const { error: deleteError } = await admin
      .from("assets")
      .delete()
      .in("id", assetIds);
    if (deleteError) {
      throw new HttpError(500, "UNKNOWN", "에셋을 지우지 못했습니다.");
    }

    return json({ ok: true, purged: assetIds.length });
  }),
);
