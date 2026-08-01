import {
  createClient,
  type SupabaseClient,
  type User,
} from "jsr:@supabase/supabase-js@2";

import type {
  MemberRole,
  StorageConnectionRow,
  StorageErrorCode,
} from "./types.ts";

export const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, apikey, content-type, x-webhook-secret",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
};

export class HttpError extends Error {
  constructor(
    readonly status: number,
    readonly code: StorageErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "HttpError";
  }
}

export interface RequestContext {
  admin: SupabaseClient;
  user: User;
  accessToken: string;
}

export function requiredEnv(name: string): string {
  const value = Deno.env.get(name);
  if (!value) {
    throw new HttpError(
      500,
      "UNKNOWN",
      `서버 환경 변수 ${name}이 설정되지 않았습니다.`,
    );
  }
  return value;
}

export function createAdminClient(): SupabaseClient {
  return createClient(
    requiredEnv("SUPABASE_URL"),
    requiredEnv("SUPABASE_SERVICE_ROLE_KEY"),
    {
      auth: { autoRefreshToken: false, persistSession: false },
    },
  );
}

export async function authenticate(req: Request): Promise<RequestContext> {
  const authorization = req.headers.get("Authorization") ?? "";
  const match = /^Bearer\s+(.+)$/i.exec(authorization);
  if (!match) throw new HttpError(401, "TOKEN_EXPIRED", "로그인이 필요합니다.");

  const admin = createAdminClient();
  const { data, error } = await admin.auth.getUser(match[1]);
  if (error || !data.user) {
    throw new HttpError(401, "TOKEN_EXPIRED", "로그인이 만료됐습니다.");
  }

  return { admin, user: data.user, accessToken: match[1] };
}

export async function parseJson(
  req: Request,
): Promise<Record<string, unknown>> {
  try {
    const value: unknown = await req.json();
    if (!isRecord(value)) throw new Error("object required");
    return value;
  } catch {
    throw new HttpError(
      400,
      "UNKNOWN",
      "요청 본문이 올바른 JSON 객체가 아닙니다.",
    );
  }
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function requireString(
  value: unknown,
  field: string,
  options: { allowEmpty?: boolean; maxLength?: number } = {},
): string {
  if (
    typeof value !== "string" || (!options.allowEmpty && value.length === 0)
  ) {
    throw new HttpError(400, "UNKNOWN", `${field} 값이 올바르지 않습니다.`);
  }
  if (options.maxLength && value.length > options.maxLength) {
    throw new HttpError(400, "UNKNOWN", `${field} 값이 너무 깁니다.`);
  }
  return value;
}

export function optionalString(
  value: unknown,
  field: string,
): string | null | undefined {
  if (value === undefined) return undefined;
  if (value === null) return null;
  return requireString(value, field);
}

export function requireNumber(value: unknown, field: string, min = 0): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value < min) {
    throw new HttpError(400, "UNKNOWN", `${field} 값이 올바르지 않습니다.`);
  }
  return value;
}

export function requireStringArray(
  value: unknown,
  field: string,
  max: number,
): string[] {
  if (!Array.isArray(value) || value.length === 0 || value.length > max) {
    throw new HttpError(
      400,
      "UNKNOWN",
      `${field}는 1개 이상 ${max}개 이하여야 합니다.`,
    );
  }
  const result = value.map((item) => requireString(item, field));
  if (new Set(result).size !== result.length) {
    throw new HttpError(400, "UNKNOWN", `${field}에 중복 값이 있습니다.`);
  }
  return result;
}

export async function getSpaceRole(
  admin: SupabaseClient,
  spaceId: string,
  userId: string,
): Promise<MemberRole | null> {
  const { data, error } = await admin
    .from("space_members")
    .select("role")
    .eq("space_id", spaceId)
    .eq("user_id", userId)
    .maybeSingle();
  if (error) {
    throw new HttpError(500, "UNKNOWN", "스페이스 권한을 확인하지 못했습니다.");
  }
  return (data?.role as MemberRole | undefined) ?? null;
}

export async function assertSpaceRole(
  admin: SupabaseClient,
  spaceId: string,
  userId: string,
  allowed: readonly MemberRole[],
): Promise<MemberRole> {
  const role = await getSpaceRole(admin, spaceId, userId);
  if (!role || !allowed.includes(role)) {
    throw new HttpError(403, "FORBIDDEN", "이 작업을 수행할 권한이 없습니다.");
  }
  return role;
}

export async function getActiveConnection(
  admin: SupabaseClient,
  spaceId: string,
): Promise<StorageConnectionRow> {
  const { data, error } = await admin
    .from("storage_connections")
    .select("*")
    .eq("space_id", spaceId)
    .eq("is_active", true)
    .maybeSingle();
  if (error) {
    throw new HttpError(500, "UNKNOWN", "스토리지 연결을 조회하지 못했습니다.");
  }
  if (!data) throw new HttpError(409, "REVOKED", "연결된 스토리지가 없습니다.");
  if (data.provider !== "google_drive") {
    throw new HttpError(
      400,
      "UNSUPPORTED",
      "아직 지원하지 않는 스토리지입니다.",
    );
  }
  return data as StorageConnectionRow;
}

export function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      ...corsHeaders,
      "Content-Type": "application/json; charset=utf-8",
    },
  });
}

export function withErrorHandling(
  handler: (req: Request) => Promise<Response>,
): (req: Request) => Promise<Response> {
  return async (req) => {
    if (req.method === "OPTIONS") {
      return new Response("ok", { headers: corsHeaders });
    }
    try {
      return await handler(req);
    } catch (error) {
      if (error instanceof HttpError) {
        return json(
          { error: { code: error.code, message: error.message } },
          error.status,
        );
      }

      const maybe = error as {
        code?: unknown;
        message?: unknown;
        status?: unknown;
      };
      const code = isStorageErrorCode(maybe?.code) ? maybe.code : "UNKNOWN";
      const status = typeof maybe?.status === "number"
        ? maybe.status
        : statusForCode(code);
      const message = typeof maybe?.message === "string"
        ? maybe.message
        : "알 수 없는 오류가 발생했습니다.";
      console.error("Edge Function error", { code, status, message });
      return json({ error: { code, message } }, status);
    }
  };
}

function isStorageErrorCode(value: unknown): value is StorageErrorCode {
  return [
    "TOKEN_EXPIRED",
    "REVOKED",
    "QUOTA_EXCEEDED",
    "RATE_LIMITED",
    "NOT_FOUND",
    "FORBIDDEN",
    "NETWORK",
    "UNSUPPORTED",
    "UNKNOWN",
  ].includes(String(value));
}

function statusForCode(code: StorageErrorCode): number {
  switch (code) {
    case "TOKEN_EXPIRED":
    case "REVOKED":
      return 401;
    case "FORBIDDEN":
      return 403;
    case "NOT_FOUND":
      return 404;
    case "QUOTA_EXCEEDED":
    case "RATE_LIMITED":
      return 429;
    case "UNSUPPORTED":
      return 400;
    case "NETWORK":
      return 503;
    default:
      return 500;
  }
}

export function assertInternalRequest(req: Request): void {
  const expected = requiredEnv("NOTIFY_WEBHOOK_SECRET");
  const actual = req.headers.get("x-webhook-secret") ?? "";
  if (!timingSafeEqual(actual, expected)) {
    throw new HttpError(401, "FORBIDDEN", "내부 요청 인증에 실패했습니다.");
  }
}

function timingSafeEqual(a: string, b: string): boolean {
  const aa = new TextEncoder().encode(a);
  const bb = new TextEncoder().encode(b);
  const length = Math.max(aa.length, bb.length);
  let mismatch = aa.length ^ bb.length;
  for (let i = 0; i < length; i += 1) mismatch |= (aa[i] ?? 0) ^ (bb[i] ?? 0);
  return mismatch === 0;
}
