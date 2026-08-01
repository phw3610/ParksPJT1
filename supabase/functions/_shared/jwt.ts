import { HttpError, requiredEnv } from "./common.ts";

const encoder = new TextEncoder();
const decoder = new TextDecoder();

export interface DownloadClaims {
  assetId: string;
  userId: string;
  spaceId: string;
  iat: number;
  exp: number;
  iss: "parks-download";
}

export async function signDownloadTicket(
  claims: Omit<DownloadClaims, "iat" | "exp" | "iss">,
  ttlSec = 300,
): Promise<{ token: string; expiresAt: string }> {
  const now = Math.floor(Date.now() / 1000);
  const expires = now + ttlSec;
  const header = base64Url(
    encoder.encode(JSON.stringify({ alg: "HS256", typ: "JWT" })),
  );
  const payload = base64Url(
    encoder.encode(
      JSON.stringify({
        ...claims,
        iat: now,
        exp: expires,
        iss: "parks-download",
      }),
    ),
  );
  const signingInput = `${header}.${payload}`;
  const signature = await crypto.subtle.sign(
    "HMAC",
    await signingKey(),
    encoder.encode(signingInput),
  );
  return {
    token: `${signingInput}.${base64Url(new Uint8Array(signature))}`,
    expiresAt: new Date(expires * 1000).toISOString(),
  };
}

export async function verifyDownloadTicket(
  token: string,
): Promise<DownloadClaims> {
  const parts = token.split(".");
  if (parts.length !== 3) throw invalidTicket();
  const signingInput = `${parts[0]}.${parts[1]}`;
  let signature: Uint8Array;
  let claims: unknown;
  try {
    signature = decodeBase64Url(parts[2]);
    claims = JSON.parse(decoder.decode(decodeBase64Url(parts[1])));
  } catch {
    throw invalidTicket();
  }

  const valid = await crypto.subtle.verify(
    "HMAC",
    await signingKey(),
    signature,
    encoder.encode(signingInput),
  );
  if (
    !valid || !isDownloadClaims(claims) ||
    claims.exp <= Math.floor(Date.now() / 1000)
  ) {
    throw invalidTicket();
  }
  return claims;
}

function signingKey(): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    "raw",
    encoder.encode(requiredEnv("DOWNLOAD_TICKET_SIGNING_KEY")),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign", "verify"],
  );
}

function isDownloadClaims(value: unknown): value is DownloadClaims {
  if (typeof value !== "object" || value === null) return false;
  const v = value as Record<string, unknown>;
  return (
    typeof v.assetId === "string" &&
    typeof v.userId === "string" &&
    typeof v.spaceId === "string" &&
    typeof v.iat === "number" &&
    typeof v.exp === "number" &&
    v.iss === "parks-download"
  );
}

function invalidTicket(): HttpError {
  return new HttpError(401, "TOKEN_EXPIRED", "다운로드 링크가 만료됐습니다.");
}

export function base64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_");
}

export function decodeBase64Url(value: string): Uint8Array {
  const padded = value.replace(/-/g, "+").replace(/_/g, "/").padEnd(
    Math.ceil(value.length / 4) * 4,
    "=",
  );
  const binary = atob(padded);
  return Uint8Array.from(binary, (char) => char.charCodeAt(0));
}
