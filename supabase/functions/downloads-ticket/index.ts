import {
  authenticate,
  getSpaceRole,
  HttpError,
  json,
  parseJson,
  requiredEnv,
  requireStringArray,
  withErrorHandling,
} from "../_shared/common.ts";
import { signDownloadTicket } from "../_shared/jwt.ts";

const IMAGE_TICKET_TTL_SECONDS = 300;
const VIDEO_TICKET_TTL_SECONDS = 4 * 60 * 60;

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
      .select("id,space_id,kind,status,remote_file_id,deleted_at")
      .in("id", assetIds);
    if (error) {
      throw new HttpError(
        500,
        "UNKNOWN",
        "다운로드 에셋을 조회하지 못했습니다.",
      );
    }
    if (!assets || assets.length !== assetIds.length) {
      throw new HttpError(404, "NOT_FOUND", "일부 에셋을 찾을 수 없습니다.");
    }

    const byId = new Map(assets.map((asset) => [asset.id, asset]));
    const roles = new Map<string, string | null>();
    const tickets = [];
    const baseUrl = requiredEnv("SUPABASE_URL").replace(/\/$/, "");
    for (const assetId of assetIds) {
      const asset = byId.get(assetId)!;
      if (
        asset.deleted_at || asset.status !== "ready" || !asset.remote_file_id
      ) {
        throw new HttpError(
          404,
          "NOT_FOUND",
          "다운로드할 원본을 찾을 수 없습니다.",
        );
      }
      if (!roles.has(asset.space_id)) {
        roles.set(
          asset.space_id,
          await getSpaceRole(admin, asset.space_id, user.id),
        );
      }
      if (!roles.get(asset.space_id)) {
        throw new HttpError(
          403,
          "FORBIDDEN",
          "이 에셋을 다운로드할 권한이 없습니다.",
        );
      }
      // 영상은 재생 내내 같은 티켓으로 Range 요청을 이어가므로 5분으로는 도중에 끊긴다.
      const signed = await signDownloadTicket(
        { assetId: asset.id, userId: user.id, spaceId: asset.space_id },
        asset.kind === "video" ? VIDEO_TICKET_TTL_SECONDS : IMAGE_TICKET_TTL_SECONDS,
      );
      tickets.push({
        assetId: asset.id,
        kind: "proxy" as const,
        url: `${baseUrl}/functions/v1/download?t=${
          encodeURIComponent(signed.token)
        }`,
        expiresAt: signed.expiresAt,
      });
    }
    return json({ tickets });
  }),
);
