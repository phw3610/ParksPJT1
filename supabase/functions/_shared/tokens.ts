import type { SupabaseClient } from "jsr:@supabase/supabase-js@2";

import { HttpError, requiredEnv } from "./common.ts";
import type { StorageConnectionRow } from "./types.ts";

const GOOGLE_TOKEN_ENDPOINT = "https://oauth2.googleapis.com/token";
const GOOGLE_REVOKE_ENDPOINT = "https://oauth2.googleapis.com/revoke";
const REFRESH_EARLY_MS = 5 * 60 * 1000;

interface CachedToken {
  accessToken: string;
  expiresAt: number;
}

export interface GoogleTokenResponse {
  access_token: string;
  expires_in: number;
  refresh_token?: string;
  scope?: string;
  token_type?: string;
}

const accessTokenCache = new Map<string, CachedToken>();

function googleClientId(): string {
  return requiredEnv("GOOGLE_CLIENT_ID");
}

function googleClientSecret(): string {
  return requiredEnv("GOOGLE_CLIENT_SECRET");
}

export async function exchangeAuthorizationCode(
  code: string,
): Promise<GoogleTokenResponse> {
  const body = new URLSearchParams({
    code,
    client_id: googleClientId(),
    client_secret: googleClientSecret(),
    grant_type: "authorization_code",
  });
  const redirectUri = Deno.env.get("GOOGLE_REDIRECT_URI");
  if (redirectUri) body.set("redirect_uri", redirectUri);

  const response = await fetch(GOOGLE_TOKEN_ENDPOINT, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });
  const payload = await readJson(response);
  if (!response.ok) {
    const reason = typeof payload.error === "string"
      ? payload.error
      : "unknown";
    throw new HttpError(
      reason === "invalid_grant" ? 401 : 502,
      reason === "invalid_grant" ? "TOKEN_EXPIRED" : "NETWORK",
      reason === "invalid_grant"
        ? "Google 동의가 만료됐습니다. 다시 연결해 주세요."
        : "Google 인증 서버에 연결하지 못했습니다.",
    );
  }

  return validateTokenResponse(payload);
}

export async function storeRefreshToken(
  admin: SupabaseClient,
  refreshToken: string,
): Promise<string> {
  const { data, error } = await admin.rpc("create_vault_secret", {
    p_secret: refreshToken,
  });
  if (error || typeof data !== "string") {
    throw new HttpError(
      500,
      "UNKNOWN",
      "Google 인증 정보를 안전하게 저장하지 못했습니다.",
    );
  }
  return data;
}

export async function readRefreshToken(
  admin: SupabaseClient,
  secretId: string,
): Promise<string> {
  const { data, error } = await admin.rpc("read_vault_secret", {
    p_secret_id: secretId,
  });
  if (error || typeof data !== "string" || data.length === 0) {
    throw new HttpError(
      401,
      "REVOKED",
      "Google Drive 연결 정보가 없습니다. 다시 연결해 주세요.",
    );
  }
  return data;
}

export async function deleteRefreshToken(
  admin: SupabaseClient,
  secretId: string,
): Promise<void> {
  const { error } = await admin.rpc("delete_vault_secret", {
    p_secret_id: secretId,
  });
  if (error) {
    throw new HttpError(
      500,
      "UNKNOWN",
      "Google 인증 정보를 삭제하지 못했습니다.",
    );
  }
}

export async function getAccessToken(
  admin: SupabaseClient,
  connection: StorageConnectionRow,
): Promise<string> {
  const cached = accessTokenCache.get(connection.id);
  if (cached && cached.expiresAt - REFRESH_EARLY_MS > Date.now()) {
    return cached.accessToken;
  }

  const refreshToken = await readRefreshToken(
    admin,
    connection.vault_secret_id,
  );
  const response = await fetch(GOOGLE_TOKEN_ENDPOINT, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      refresh_token: refreshToken,
      client_id: googleClientId(),
      client_secret: googleClientSecret(),
      grant_type: "refresh_token",
    }),
  });
  const payload = await readJson(response);

  if (!response.ok) {
    const reason = typeof payload.error === "string"
      ? payload.error
      : "unknown";
    if (reason === "invalid_grant") {
      accessTokenCache.delete(connection.id);
      await admin
        .from("storage_connections")
        .update({
          last_error: "revoked",
          last_verified_at: new Date().toISOString(),
        })
        .eq("id", connection.id);
      throw new HttpError(
        401,
        "REVOKED",
        "Google Drive 접근 권한이 해제됐습니다. 다시 연결해 주세요.",
      );
    }
    throw new HttpError(
      503,
      "NETWORK",
      "Google 인증 토큰을 갱신하지 못했습니다.",
    );
  }

  const token = validateTokenResponse(payload);
  cacheAccessToken(connection.id, token.access_token, token.expires_in);
  await admin
    .from("storage_connections")
    .update({ last_error: null, last_verified_at: new Date().toISOString() })
    .eq("id", connection.id);
  return token.access_token;
}

export function cacheAccessToken(
  connectionId: string,
  accessToken: string,
  expiresInSec: number,
): void {
  accessTokenCache.set(connectionId, {
    accessToken,
    expiresAt: Date.now() + Math.max(60, expiresInSec) * 1000,
  });
}

export function clearAccessToken(connectionId: string): void {
  accessTokenCache.delete(connectionId);
}

export async function revokeGoogleToken(token: string): Promise<void> {
  const response = await fetch(GOOGLE_REVOKE_ENDPOINT, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ token }),
  });
  // Revoking an already-invalid token is equivalent to the desired end state.
  if (!response.ok && response.status !== 400) {
    throw new HttpError(
      503,
      "NETWORK",
      "Google 권한을 해제하지 못했습니다. 잠시 후 다시 시도해 주세요.",
    );
  }
}

function validateTokenResponse(
  payload: Record<string, unknown>,
): GoogleTokenResponse {
  if (
    typeof payload.access_token !== "string" ||
    typeof payload.expires_in !== "number"
  ) {
    throw new HttpError(
      502,
      "NETWORK",
      "Google 인증 서버가 올바르지 않은 응답을 반환했습니다.",
    );
  }
  return {
    access_token: payload.access_token,
    expires_in: payload.expires_in,
    refresh_token: typeof payload.refresh_token === "string"
      ? payload.refresh_token
      : undefined,
    scope: typeof payload.scope === "string" ? payload.scope : undefined,
    token_type: typeof payload.token_type === "string"
      ? payload.token_type
      : undefined,
  };
}

async function readJson(response: Response): Promise<Record<string, unknown>> {
  try {
    const payload: unknown = await response.json();
    return typeof payload === "object" && payload !== null
      ? (payload as Record<string, unknown>)
      : {};
  } catch {
    return {};
  }
}
