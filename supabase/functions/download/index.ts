import {
  corsHeaders,
  createAdminClient,
  getActiveConnection,
  getSpaceRole,
  HttpError,
  withErrorHandling,
} from "../_shared/common.ts";
import { DriveError, GoogleDriveProvider } from "../_shared/googleDrive.ts";
import { verifyDownloadTicket } from "../_shared/jwt.ts";
import { getAccessToken } from "../_shared/tokens.ts";

Deno.serve(
  withErrorHandling(async (req) => {
    if (req.method !== "GET") {
      throw new HttpError(405, "UNSUPPORTED", "GET 요청만 지원합니다.");
    }
    const ticket = new URL(req.url).searchParams.get("t");
    if (!ticket) {
      throw new HttpError(401, "TOKEN_EXPIRED", "다운로드 티켓이 없습니다.");
    }
    const claims = await verifyDownloadTicket(ticket);
    const admin = createAdminClient();

    // A ticket is invalidated immediately when its user leaves the space.
    if (!(await getSpaceRole(admin, claims.spaceId, claims.userId))) {
      throw new HttpError(403, "FORBIDDEN", "스페이스 접근 권한이 없습니다.");
    }
    const { data: asset, error } = await admin
      .from("assets")
      .select(
        "id,space_id,original_name,mime_type,remote_file_id,status,deleted_at",
      )
      .eq("id", claims.assetId)
      .eq("space_id", claims.spaceId)
      .is("deleted_at", null)
      .maybeSingle();
    if (error) {
      throw new HttpError(
        500,
        "UNKNOWN",
        "다운로드 에셋을 조회하지 못했습니다.",
      );
    }
    if (!asset || asset.status !== "ready" || !asset.remote_file_id) {
      throw new HttpError(
        404,
        "NOT_FOUND",
        "다운로드할 원본을 찾을 수 없습니다.",
      );
    }

    const connection = await getActiveConnection(admin, claims.spaceId);
    const drive = new GoogleDriveProvider({
      getAccessToken: async () => await getAccessToken(admin, connection),
    });
    let upstream: Response;
    try {
      upstream = await drive.download(
        asset.remote_file_id,
        req.headers.get("Range"),
      );
    } catch (error) {
      if (error instanceof DriveError && error.code === "NOT_FOUND") {
        await admin.from("assets").update({
          status: "orphaned",
          error_code: "NOT_FOUND",
        }).eq("id", asset.id);
      }
      throw error;
    }

    const headers = new Headers(corsHeaders);
    for (
      const name of [
        "Content-Length",
        "Content-Range",
        "Accept-Ranges",
        "ETag",
        "Last-Modified",
      ]
    ) {
      const value = upstream.headers.get(name);
      if (value) headers.set(name, value);
    }
    headers.set(
      "Content-Type",
      upstream.headers.get("Content-Type") ?? asset.mime_type,
    );
    headers.set(
      "Content-Disposition",
      `inline; filename*=UTF-8''${encodeURIComponent(asset.original_name)}`,
    );
    headers.set("Cache-Control", "private, no-store");
    headers.set(
      "Access-Control-Expose-Headers",
      "Content-Length, Content-Range, Accept-Ranges",
    );
    return new Response(upstream.body, { status: upstream.status, headers });
  }),
);
