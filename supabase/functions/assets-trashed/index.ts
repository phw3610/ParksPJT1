import {
  authenticate,
  getSpaceRole,
  HttpError,
  json,
  parseJson,
  requireString,
  withErrorHandling,
} from "../_shared/common.ts";

const PAGE_SIZE = 100;

/**
 * 휴지통 목록. `assets_select` RLS가 `deleted_at is null`이라 클라이언트는
 * 삭제된 행을 직접 조회할 수 없으므로 이 함수가 admin 권한으로 대신 읽는다.
 */
Deno.serve(
  withErrorHandling(async (req) => {
    if (req.method !== "POST") {
      throw new HttpError(405, "UNSUPPORTED", "POST 요청만 지원합니다.");
    }
    const { admin, user } = await authenticate(req);
    const body = await parseJson(req);
    const spaceId = requireString(body.spaceId, "spaceId");

    const role = await getSpaceRole(admin, spaceId, user.id);
    if (!role) {
      throw new HttpError(403, "FORBIDDEN", "이 앨범에 접근할 권한이 없습니다.");
    }

    const { data, error } = await admin
      .from("assets")
      .select(
        "id,space_id,folder_id,uploader_id,kind,original_name,byte_size,width,height,duration_ms,thumb_path,captured_at,created_at,deleted_at",
      )
      .eq("space_id", spaceId)
      .not("deleted_at", "is", null)
      .order("deleted_at", { ascending: false })
      .limit(PAGE_SIZE);

    if (error) {
      throw new HttpError(500, "UNKNOWN", "휴지통을 불러오지 못했습니다.");
    }

    // 되돌리기·지우기 권한은 삭제와 같은 규칙이다. 멤버는 자기가 올린 것만 다룰 수 있으므로
    // 화면에서 미리 구분할 수 있게 항목마다 표시해 준다.
    const canManageAll = role === "owner" || role === "admin";
    const items = (data ?? []).map((asset) => ({
      ...asset,
      canRestore: canManageAll ||
        (role === "member" && asset.uploader_id === user.id),
    }));

    return json({ items });
  }),
);
