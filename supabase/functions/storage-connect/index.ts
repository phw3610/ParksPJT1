import {
  authenticate,
  HttpError,
  json,
  parseJson,
  requireString,
  withErrorHandling,
} from "../_shared/common.ts";
import { GoogleDriveProvider } from "../_shared/googleDrive.ts";
import {
  cacheAccessToken,
  deleteRefreshToken,
  exchangeAuthorizationCode,
  storeRefreshToken,
} from "../_shared/tokens.ts";

Deno.serve(
  withErrorHandling(async (req) => {
    if (req.method !== "POST") {
      throw new HttpError(405, "UNSUPPORTED", "POST 요청만 지원합니다.");
    }
    const { admin, user } = await authenticate(req);
    const body = await parseJson(req);
    const spaceId = requireString(body.spaceId, "spaceId");
    const providerKind = requireString(body.provider, "provider");
    const serverAuthCode = requireString(body.serverAuthCode, "serverAuthCode");
    if (providerKind !== "google_drive") {
      throw new HttpError(
        400,
        "UNSUPPORTED",
        "Phase 1에서는 Google Drive만 연결할 수 있습니다.",
      );
    }

    const { data: membership, error: roleError } = await admin
      .from("space_members")
      .select("role")
      .eq("space_id", spaceId)
      .eq("user_id", user.id)
      .maybeSingle();
    if (roleError) {
      throw new HttpError(
        500,
        "UNKNOWN",
        "스페이스 권한을 확인하지 못했습니다.",
      );
    }
    if (membership?.role !== "owner") {
      throw new HttpError(
        403,
        "FORBIDDEN",
        "스페이스 Owner만 스토리지를 연결할 수 있습니다.",
      );
    }

    const tokens = await exchangeAuthorizationCode(serverAuthCode);
    if (!tokens.refresh_token) {
      // The client contract understands TOKEN_EXPIRED and will restart consent.
      throw new HttpError(
        409,
        "TOKEN_EXPIRED",
        "Google의 새 동의가 필요합니다. 계정 선택 화면에서 다시 허용해 주세요.",
      );
    }

    const drive = new GoogleDriveProvider({
      getAccessToken: () => Promise.resolve(tokens.access_token),
    });
    const connected = await drive.connect({ spaceId });
    const quota = await drive.quota();
    const vaultSecretId = await storeRefreshToken(admin, tokens.refresh_token);

    const { data: previous, error: previousError } = await admin
      .from("storage_connections")
      .select("*")
      .eq("space_id", spaceId)
      .eq("is_active", true)
      .maybeSingle();
    if (previousError) {
      await deleteRefreshToken(admin, vaultSecretId);
      throw new HttpError(
        500,
        "UNKNOWN",
        "기존 스토리지 연결을 확인하지 못했습니다.",
      );
    }

    if (previous) {
      const { error } = await admin
        .from("storage_connections")
        .update({ is_active: false })
        .eq("id", previous.id);
      if (error) {
        await deleteRefreshToken(admin, vaultSecretId);
        throw new HttpError(
          500,
          "UNKNOWN",
          "기존 스토리지 연결을 교체하지 못했습니다.",
        );
      }
    }

    const connectionId = crypto.randomUUID();
    const { error: insertError } = await admin.from("storage_connections")
      .insert({
        id: connectionId,
        space_id: spaceId,
        provider: "google_drive",
        connected_by: user.id,
        account_label: connected.accountLabel,
        root_folder_id: connected.rootFolderId,
        vault_secret_id: vaultSecretId,
        is_active: true,
        last_error: null,
        last_verified_at: new Date().toISOString(),
      });
    if (insertError) {
      if (previous) {
        await admin.from("storage_connections").update({ is_active: true }).eq(
          "id",
          previous.id,
        );
      }
      await deleteRefreshToken(admin, vaultSecretId);
      throw new HttpError(
        500,
        "UNKNOWN",
        "스토리지 연결을 저장하지 못했습니다.",
      );
    }

    cacheAccessToken(connectionId, tokens.access_token, tokens.expires_in);
    if (previous?.vault_secret_id) {
      try {
        await deleteRefreshToken(admin, previous.vault_secret_id);
      } catch (error) {
        console.error("Old Vault secret cleanup failed", {
          connectionId: previous.id,
          message: error instanceof Error ? error.message : String(error),
        });
      }
    }

    return json({
      connectionId,
      accountLabel: connected.accountLabel,
      rootFolderId: connected.rootFolderId,
      quota,
    });
  }),
);
