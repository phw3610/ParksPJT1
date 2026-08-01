import { base64Url, decodeBase64Url } from "./jwt.ts";

const encoder = new TextEncoder();

interface PushMessage {
  title: string;
  body: string;
  data: Record<string, string>;
}

export interface PushResult {
  ok: boolean;
  removeToken: boolean;
  error?: string;
}

interface FcmServiceAccount {
  client_email: string;
  private_key: string;
  project_id: string;
  token_uri?: string;
}

let fcmAccessToken: { token: string; expiresAt: number } | null = null;
let apnsProviderToken: { token: string; expiresAt: number } | null = null;

export async function sendPush(
  platform: "ios" | "android",
  token: string,
  message: PushMessage,
): Promise<PushResult> {
  try {
    return platform === "android"
      ? await sendFcm(token, message)
      : await sendApns(token, message);
  } catch (error) {
    return {
      ok: false,
      removeToken: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

async function sendFcm(
  token: string,
  message: PushMessage,
): Promise<PushResult> {
  const account = fcmAccount();
  const response = await fetch(
    `https://fcm.googleapis.com/v1/projects/${
      encodeURIComponent(account.project_id)
    }/messages:send`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${await getFcmAccessToken(account)}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        message: {
          token,
          notification: { title: message.title, body: message.body },
          data: message.data,
          android: { priority: "high" },
        },
      }),
    },
  );
  if (response.ok) return { ok: true, removeToken: false };

  const text = await response.text();
  const invalid = response.status === 404 || text.includes("UNREGISTERED");
  return {
    ok: false,
    removeToken: invalid,
    error: `FCM ${response.status}: ${text.slice(0, 300)}`,
  };
}

async function getFcmAccessToken(account: FcmServiceAccount): Promise<string> {
  if (fcmAccessToken && fcmAccessToken.expiresAt - 60_000 > Date.now()) {
    return fcmAccessToken.token;
  }
  const now = Math.floor(Date.now() / 1000);
  const header = base64Url(
    encoder.encode(JSON.stringify({ alg: "RS256", typ: "JWT" })),
  );
  const payload = base64Url(
    encoder.encode(
      JSON.stringify({
        iss: account.client_email,
        scope: "https://www.googleapis.com/auth/firebase.messaging",
        aud: account.token_uri ?? "https://oauth2.googleapis.com/token",
        iat: now,
        exp: now + 3600,
      }),
    ),
  );
  const input = `${header}.${payload}`;
  const key = await crypto.subtle.importKey(
    "pkcs8",
    pemBytes(account.private_key),
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign(
    "RSASSA-PKCS1-v1_5",
    key,
    encoder.encode(input),
  );
  const assertion = `${input}.${base64Url(new Uint8Array(signature))}`;
  const response = await fetch(
    account.token_uri ?? "https://oauth2.googleapis.com/token",
    {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
        assertion,
      }),
    },
  );
  const data = (await response.json()) as {
    access_token?: string;
    expires_in?: number;
    error?: string;
  };
  if (!response.ok || !data.access_token) {
    throw new Error(`FCM OAuth 실패: ${data.error ?? response.status}`);
  }
  fcmAccessToken = {
    token: data.access_token,
    expiresAt: Date.now() + (data.expires_in ?? 3600) * 1000,
  };
  return data.access_token;
}

async function sendApns(
  token: string,
  message: PushMessage,
): Promise<PushResult> {
  const useSandbox = Deno.env.get("APNS_USE_SANDBOX") === "true";
  const host = useSandbox
    ? "https://api.sandbox.push.apple.com"
    : "https://api.push.apple.com";
  const topic = required("APNS_BUNDLE_ID");
  const response = await fetch(
    `${host}/3/device/${encodeURIComponent(token)}`,
    {
      method: "POST",
      headers: {
        Authorization: `bearer ${await getApnsProviderToken()}`,
        "apns-topic": topic,
        "apns-push-type": "alert",
        "apns-priority": "10",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        aps: {
          alert: { title: message.title, body: message.body },
          sound: "default",
        },
        ...message.data,
      }),
    },
  );
  if (response.ok) return { ok: true, removeToken: false };
  const payload = (await response.json().catch(() => ({}))) as {
    reason?: string;
  };
  const invalid = response.status === 410 ||
    payload.reason === "BadDeviceToken" || payload.reason === "Unregistered";
  return {
    ok: false,
    removeToken: invalid,
    error: `APNs ${response.status}: ${payload.reason ?? response.statusText}`,
  };
}

async function getApnsProviderToken(): Promise<string> {
  if (apnsProviderToken && apnsProviderToken.expiresAt > Date.now()) {
    return apnsProviderToken.token;
  }
  const keyId = required("APNS_KEY_ID");
  const teamId = required("APNS_TEAM_ID");
  const now = Math.floor(Date.now() / 1000);
  const header = base64Url(
    encoder.encode(JSON.stringify({ alg: "ES256", kid: keyId })),
  );
  const payload = base64Url(
    encoder.encode(JSON.stringify({ iss: teamId, iat: now })),
  );
  const input = `${header}.${payload}`;
  const key = await crypto.subtle.importKey(
    "pkcs8",
    pemBytes(required("APNS_PRIVATE_KEY")),
    { name: "ECDSA", namedCurve: "P-256" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign(
    { name: "ECDSA", hash: "SHA-256" },
    key,
    encoder.encode(input),
  );
  const token = `${input}.${
    base64Url(normalizeEcdsaSignature(new Uint8Array(signature)))
  }`;
  // APNs tokens may be reused for up to one hour; rotate after 50 minutes.
  apnsProviderToken = { token, expiresAt: Date.now() + 50 * 60 * 1000 };
  return token;
}

function fcmAccount(): FcmServiceAccount {
  const raw = required("FCM_SERVICE_ACCOUNT_JSON");
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    throw new Error("FCM_SERVICE_ACCOUNT_JSON이 올바른 JSON이 아닙니다.");
  }
  const v = value as Partial<FcmServiceAccount>;
  if (!v.client_email || !v.private_key || !v.project_id) {
    throw new Error("FCM 서비스 계정 필수 필드가 없습니다.");
  }
  return v as FcmServiceAccount;
}

function required(name: string): string {
  const value = Deno.env.get(name);
  if (!value) throw new Error(`${name} 환경 변수가 설정되지 않았습니다.`);
  return value;
}

function pemBytes(pem: string): Uint8Array {
  const base64 = pem.replace(/-----BEGIN [^-]+-----/g, "").replace(
    /-----END [^-]+-----/g,
    "",
  ).replace(/\s/g, "");
  return decodeBase64Url(base64.replace(/\+/g, "-").replace(/\//g, "_"));
}

/** Some runtimes return DER ECDSA signatures; JWS requires raw r || s. */
function normalizeEcdsaSignature(signature: Uint8Array): Uint8Array {
  if (signature.length === 64) return signature;
  if (signature[0] !== 0x30) {
    throw new Error("지원하지 않는 APNs ECDSA 서명 형식입니다.");
  }
  let offset = 2;
  if (signature[1] & 0x80) offset = 2 + (signature[1] & 0x7f);
  if (signature[offset++] !== 0x02) {
    throw new Error("APNs ECDSA r 값을 읽지 못했습니다.");
  }
  const rLength = signature[offset++];
  const r = signature.slice(offset, offset + rLength);
  offset += rLength;
  if (signature[offset++] !== 0x02) {
    throw new Error("APNs ECDSA s 값을 읽지 못했습니다.");
  }
  const sLength = signature[offset++];
  const s = signature.slice(offset, offset + sLength);
  const raw = new Uint8Array(64);
  raw.set(r.slice(Math.max(0, r.length - 32)), Math.max(0, 32 - r.length));
  raw.set(s.slice(Math.max(0, s.length - 32)), 32 + Math.max(0, 32 - s.length));
  return raw;
}
