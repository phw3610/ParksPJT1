/**
 * AWS Signature Version 4. Web Crypto만 쓴다.
 *
 * @aws-sdk를 넣지 않는 이유: 서명은 순수 해시 계산이라 SDK가 필요 없고,
 * Edge Function은 요청마다 콜드 스타트가 걸릴 수 있어 번들이 작을수록 좋다.
 */

const ALGORITHM = "AWS4-HMAC-SHA256";
const UNSIGNED_PAYLOAD = "UNSIGNED-PAYLOAD";
const EMPTY_SHA256 =
  "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855";

export interface S3Credentials {
  endpoint: string;
  region: string;
  bucket: string;
  accessKeyId: string;
  secretAccessKey: string;
  /** MinIO·Synology처럼 가상 호스트 방식을 못 쓰는 서버는 true. */
  forcePathStyle: boolean;
}

const encoder = new TextEncoder();

function toHex(buffer: ArrayBuffer): string {
  return Array.from(new Uint8Array(buffer))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

async function sha256Hex(data: string | Uint8Array): Promise<string> {
  const bytes = typeof data === "string" ? encoder.encode(data) : data;
  return toHex(await crypto.subtle.digest("SHA-256", bytes as BufferSource));
}

async function hmac(
  key: ArrayBuffer | Uint8Array,
  message: string,
): Promise<ArrayBuffer> {
  const cryptoKey = await crypto.subtle.importKey(
    "raw",
    key as BufferSource,
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  return await crypto.subtle.sign("HMAC", cryptoKey, encoder.encode(message));
}

/**
 * S3는 경로 세그먼트의 슬래시를 살려야 하고 encodeURIComponent가 남기는
 * !'()* 까지 인코딩해야 서명이 맞는다.
 */
function encodeSegment(value: string): string {
  return encodeURIComponent(value).replace(
    /[!'()*]/g,
    (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`,
  );
}

export function encodeKey(key: string): string {
  return key.split("/").map(encodeSegment).join("/");
}

function amzDates(now: Date): { amzDate: string; dateStamp: string } {
  const amzDate = now.toISOString().replace(/[:-]|\.\d{3}/g, "");
  return { amzDate, dateStamp: amzDate.slice(0, 8) };
}

async function signingKey(
  credentials: S3Credentials,
  dateStamp: string,
): Promise<ArrayBuffer> {
  const kDate = await hmac(
    encoder.encode(`AWS4${credentials.secretAccessKey}`),
    dateStamp,
  );
  const kRegion = await hmac(kDate, credentials.region);
  const kService = await hmac(kRegion, "s3");
  return await hmac(kService, "aws4_request");
}

function canonicalQuery(params: URLSearchParams): string {
  const pairs: [string, string][] = [];
  params.forEach((value, key) => pairs.push([key, value]));
  pairs.sort((a, b) => (a[0] === b[0] ? (a[1] < b[1] ? -1 : 1) : a[0] < b[0] ? -1 : 1));
  return pairs
    .map(([key, value]) => `${encodeSegment(key)}=${encodeSegment(value)}`)
    .join("&");
}

/** 버킷을 경로에 넣을지 호스트에 넣을지는 서버 설정에 달렸다. */
export function objectUrl(credentials: S3Credentials, key: string): URL {
  const base = new URL(credentials.endpoint);
  const encodedKey = encodeKey(key);

  if (credentials.forcePathStyle) {
    base.pathname = `/${credentials.bucket}${encodedKey ? `/${encodedKey}` : ""}`;
  } else {
    base.hostname = `${credentials.bucket}.${base.hostname}`;
    base.pathname = `/${encodedKey}`;
  }
  return base;
}

/**
 * 쿼리 문자열 서명. 기기가 이 URL로 NAS와 직접 통신하므로
 * 업로드·다운로드 대역폭이 우리 서버를 거치지 않는다.
 */
export async function presignUrl(
  credentials: S3Credentials,
  method: "GET" | "PUT",
  key: string,
  expiresInSeconds: number,
  extraQuery: Record<string, string> = {},
): Promise<string> {
  const url = objectUrl(credentials, key);
  const { amzDate, dateStamp } = amzDates(new Date());
  const scope = `${dateStamp}/${credentials.region}/s3/aws4_request`;

  const query = new URLSearchParams(extraQuery);
  query.set("X-Amz-Algorithm", ALGORITHM);
  query.set("X-Amz-Credential", `${credentials.accessKeyId}/${scope}`);
  query.set("X-Amz-Date", amzDate);
  query.set("X-Amz-Expires", String(Math.min(expiresInSeconds, 604800)));
  query.set("X-Amz-SignedHeaders", "host");

  const canonicalRequest = [
    method,
    url.pathname,
    canonicalQuery(query),
    `host:${url.host}\n`,
    "host",
    UNSIGNED_PAYLOAD,
  ].join("\n");

  const stringToSign = [
    ALGORITHM,
    amzDate,
    scope,
    await sha256Hex(canonicalRequest),
  ].join("\n");

  const signature = toHex(
    await hmac(await signingKey(credentials, dateStamp), stringToSign),
  );

  query.set("X-Amz-Signature", signature);
  url.search = query.toString();
  return url.toString();
}

/** 헤더 서명. 목록 조회·복사·삭제처럼 서버가 직접 부르는 요청에 쓴다. */
export async function signedFetch(
  credentials: S3Credentials,
  method: string,
  key: string,
  options: {
    query?: Record<string, string>;
    headers?: Record<string, string>;
    body?: string;
  } = {},
): Promise<Response> {
  const url = objectUrl(credentials, key);
  const query = new URLSearchParams(options.query ?? {});
  url.search = canonicalQuery(query);

  const { amzDate, dateStamp } = amzDates(new Date());
  const scope = `${dateStamp}/${credentials.region}/s3/aws4_request`;
  const payloadHash = options.body ? await sha256Hex(options.body) : EMPTY_SHA256;

  const headers: Record<string, string> = {
    host: url.host,
    "x-amz-content-sha256": payloadHash,
    "x-amz-date": amzDate,
    ...Object.fromEntries(
      Object.entries(options.headers ?? {}).map(([k, v]) => [k.toLowerCase(), v]),
    ),
  };

  const sortedHeaderNames = Object.keys(headers).sort();
  const canonicalHeaders = sortedHeaderNames
    .map((name) => `${name}:${headers[name].trim()}\n`)
    .join("");
  const signedHeaders = sortedHeaderNames.join(";");

  const canonicalRequest = [
    method,
    url.pathname,
    canonicalQuery(query),
    canonicalHeaders,
    signedHeaders,
    payloadHash,
  ].join("\n");

  const stringToSign = [
    ALGORITHM,
    amzDate,
    scope,
    await sha256Hex(canonicalRequest),
  ].join("\n");

  const signature = toHex(
    await hmac(await signingKey(credentials, dateStamp), stringToSign),
  );

  return await fetch(url.toString(), {
    method,
    headers: {
      ...headers,
      Authorization:
        `${ALGORITHM} Credential=${credentials.accessKeyId}/${scope}, ` +
        `SignedHeaders=${signedHeaders}, Signature=${signature}`,
    },
    body: options.body,
  });
}
