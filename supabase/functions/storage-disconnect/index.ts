import {
  assertSpaceRole,
  authenticate,
  getActiveConnection,
  HttpError,
  json,
  parseJson,
  requireString,
  withErrorHandling,
} from "../_shared/common.ts";
import {
  clearAccessToken,
  deleteRefreshToken,
  readRefreshToken,
  revokeGoogleToken,
} from "../_shared/tokens.ts";

Deno.serve(
  withErrorHandling(async (req) => {
    if (req.method !== "POST") {
      throw new HttpError(405, "UNSUPPORTED", "POST 요청만 지원합니다.");
    }
    const { admin, user } = await authenticate(req);
    const body = await parseJson(req);
    const spaceId = requireString(body.spaceId, "spaceId");
    const revokeToken = body.revokeToken === true;
    await assertSpaceRole(admin, spaceId, user.id, ["owner"]);
    const connection = await getActiveConnection(admin, spaceId);

    if (revokeToken) {
      const refreshToken = await readRefreshToken(
        admin,
        connection.vault_secret_id,
      );
      await revokeGoogleToken(refreshToken);
    }

    const { error } = await admin
      .from("storage_connections")
      .update({ is_active: false, last_error: revokeToken ? "revoked" : null })
      .eq("id", connection.id);
    if (error) {
      throw new HttpError(
        500,
        "UNKNOWN",
        "스토리지 연결을 해제하지 못했습니다.",
      );
    }

    await deleteRefreshToken(admin, connection.vault_secret_id);
    clearAccessToken(connection.id);
    return json({ ok: true });
  }),
);
