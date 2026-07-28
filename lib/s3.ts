import { createHash, createHmac, randomUUID } from "crypto";
import { XMLParser } from "fast-xml-parser";

export type MediaKind = "image" | "video";

export type MediaItem = {
  key: string;
  name: string;
  url: string;
  downloadUrl: string;
  type: MediaKind;
  size: number;
  lastModified: string;
};

export type UploadInput = {
  name: string;
  type: string;
  size: number;
};

export type SignedUpload = {
  key: string;
  name: string;
  type: string;
  size: number;
  uploadUrl: string;
  publicUrl: string;
};

type S3Config = {
  endpoint: string;
  region: string;
  bucket: string;
  accessKey: string;
  secretKey: string;
  prefix: string;
  publicBaseUrl: string;
  maxUploadBytes: number;
};

type S3Object = {
  Key?: string;
  LastModified?: string;
  Size?: string | number;
};

const DEFAULT_MAX_UPLOAD_MB = 300;
const DEFAULT_PREFIX = "guest-media/2026-09-06";
const IMAGE_EXTENSIONS = new Set([
  "avif",
  "gif",
  "heic",
  "heif",
  "jpeg",
  "jpg",
  "png",
  "webp",
]);
const VIDEO_EXTENSIONS = new Set(["mov", "mp4", "m4v", "webm"]);

export function getS3Config(): S3Config | null {
  const endpoint = cleanUrl(process.env.S3_ENDPOINT);
  const region = process.env.S3_REGION?.trim();
  const bucket = process.env.S3_BUCKET?.trim();
  const accessKey = process.env.S3_ACCESS_KEY?.trim();
  const secretKey = process.env.S3_SECRET_KEY?.trim();

  if (!endpoint || !region || !bucket || !accessKey || !secretKey) {
    return null;
  }

  const prefix = normalizePrefix(process.env.S3_PREFIX || DEFAULT_PREFIX);
  const publicBaseUrl =
    cleanUrl(process.env.S3_PUBLIC_BASE_URL) || `${endpoint}/${bucket}`;
  const maxUploadMb = Number(process.env.MAX_UPLOAD_MB || DEFAULT_MAX_UPLOAD_MB);

  return {
    endpoint,
    region,
    bucket,
    accessKey,
    secretKey,
    prefix,
    publicBaseUrl,
    maxUploadBytes:
      Number.isFinite(maxUploadMb) && maxUploadMb > 0
        ? maxUploadMb * 1024 * 1024
        : DEFAULT_MAX_UPLOAD_MB * 1024 * 1024,
  };
}

export function isMediaUpload(file: UploadInput) {
  const type = normalizeContentType(file.type);
  return type.startsWith("image/") || type.startsWith("video/");
}

export function validateUpload(file: UploadInput, config: S3Config) {
  if (!file.name || typeof file.name !== "string") {
    return "У файла нет имени.";
  }

  if (!isMediaUpload(file)) {
    return "Можно загружать только фото и видео.";
  }

  if (!Number.isFinite(file.size) || file.size <= 0) {
    return "Файл пустой или поврежден.";
  }

  if (file.size > config.maxUploadBytes) {
    const limitMb = Math.round(config.maxUploadBytes / 1024 / 1024);
    return `Файл больше лимита ${limitMb} МБ.`;
  }

  return null;
}

export function createUploadSignatures(
  files: UploadInput[],
  config: S3Config,
): SignedUpload[] {
  return files.map((file) => {
    const contentType = normalizeContentType(file.type);
    const key = createObjectKey(file.name, config.prefix);

    return {
      key,
      name: safeFileName(file.name),
      type: contentType,
      size: file.size,
      uploadUrl: presignObjectUrl({
        config,
        method: "PUT",
        key,
        expiresSeconds: 15 * 60,
        signedHeaders: {
          "content-type": contentType,
        },
      }),
      publicUrl: publicObjectUrl(config, key),
    };
  });
}

export async function listMedia(config: S3Config): Promise<MediaItem[]> {
  const url = new URL(`${config.endpoint}/${config.bucket}`);
  url.searchParams.set("list-type", "2");
  url.searchParams.set("max-keys", "1000");
  url.searchParams.set("prefix", config.prefix);

  const response = await signedS3Fetch(config, "GET", url);
  if (!response.ok) {
    throw new Error(`S3 list failed with ${response.status}`);
  }

  const xml = await response.text();
  const parser = new XMLParser({
    ignoreAttributes: false,
    parseTagValue: false,
    trimValues: true,
  });
  const parsed = parser.parse(xml) as {
    ListBucketResult?: { Contents?: S3Object | S3Object[] };
  };

  const contents = parsed.ListBucketResult?.Contents;
  const objects = Array.isArray(contents)
    ? contents
    : contents
      ? [contents]
      : [];

  return objects
    .map((object) => toMediaItem(object, config))
    .filter((item): item is MediaItem => Boolean(item))
    .sort(
      (a, b) =>
        new Date(b.lastModified).getTime() - new Date(a.lastModified).getTime(),
    );
}

export function createDownloadUrl(config: S3Config, key: string) {
  assertAllowedKey(config, key);
  const fileName = key.split("/").pop() || "ilya-anna-media";

  return presignObjectUrl({
    config,
    method: "GET",
    key,
    expiresSeconds: 10 * 60,
    query: {
      "response-content-disposition": `attachment; filename="${fileName.replaceAll('"', "")}"`,
    },
  });
}

export function assertAllowedKey(config: S3Config, key: string) {
  if (!key || key.includes("..") || !key.startsWith(config.prefix)) {
    throw new Error("Invalid media key.");
  }
}

function toMediaItem(object: S3Object, config: S3Config): MediaItem | null {
  const key = object.Key;
  if (!key || key.endsWith("/")) return null;

  const type = inferMediaKind(key);
  if (!type) return null;

  return {
    key,
    name: key.split("/").pop() || key,
    url: publicObjectUrl(config, key),
    downloadUrl: `/api/download?key=${encodeURIComponent(key)}`,
    type,
    size: Number(object.Size || 0),
    lastModified: object.LastModified || new Date().toISOString(),
  };
}

function inferMediaKind(key: string): MediaKind | null {
  const ext = key.split(".").pop()?.toLowerCase() || "";
  if (IMAGE_EXTENSIONS.has(ext)) return "image";
  if (VIDEO_EXTENSIONS.has(ext)) return "video";
  return null;
}

function createObjectKey(fileName: string, prefix: string) {
  const safeName = safeFileName(fileName);
  const extension = safeName.includes(".")
    ? safeName.split(".").pop()?.toLowerCase()
    : "";
  const suffix = extension ? `.${extension}` : "";
  return `${prefix}${Date.now()}-${randomUUID()}${suffix}`;
}

function signedS3Fetch(config: S3Config, method: "GET", url: URL) {
  const { amzDate, dateStamp } = getAmzDates();
  const payloadHash = sha256Hex("");
  const headers = {
    host: url.host,
    "x-amz-content-sha256": payloadHash,
    "x-amz-date": amzDate,
  };
  const signedHeaders = Object.keys(headers).sort().join(";");
  const canonicalRequest = [
    method,
    canonicalUri(url.pathname),
    canonicalQueryString(Object.fromEntries(url.searchParams.entries())),
    canonicalHeaders(headers),
    signedHeaders,
    payloadHash,
  ].join("\n");
  const scope = `${dateStamp}/${config.region}/s3/aws4_request`;
  const stringToSign = [
    "AWS4-HMAC-SHA256",
    amzDate,
    scope,
    sha256Hex(canonicalRequest),
  ].join("\n");
  const signature = signString(config.secretKey, dateStamp, config.region, stringToSign);
  const authorization = `AWS4-HMAC-SHA256 Credential=${config.accessKey}/${scope}, SignedHeaders=${signedHeaders}, Signature=${signature}`;

  return fetch(url, {
    method,
    headers: {
      ...headers,
      authorization,
    },
    cache: "no-store",
  });
}

function presignObjectUrl({
  config,
  method,
  key,
  expiresSeconds,
  signedHeaders = {},
  query = {},
}: {
  config: S3Config;
  method: "GET" | "PUT";
  key: string;
  expiresSeconds: number;
  signedHeaders?: Record<string, string>;
  query?: Record<string, string>;
}) {
  const { amzDate, dateStamp } = getAmzDates();
  const url = new URL(`${config.endpoint}/${config.bucket}/${encodeKey(key)}`);
  const scope = `${dateStamp}/${config.region}/s3/aws4_request`;
  const headers = {
    host: url.host,
    ...normalizeHeaders(signedHeaders),
  };
  const signedHeaderNames = Object.keys(headers).sort().join(";");
  const queryParams = {
    ...query,
    "X-Amz-Algorithm": "AWS4-HMAC-SHA256",
    "X-Amz-Credential": `${config.accessKey}/${scope}`,
    "X-Amz-Date": amzDate,
    "X-Amz-Expires": String(expiresSeconds),
    "X-Amz-SignedHeaders": signedHeaderNames,
  };
  const canonicalRequest = [
    method,
    canonicalUri(url.pathname),
    canonicalQueryString(queryParams),
    canonicalHeaders(headers),
    signedHeaderNames,
    "UNSIGNED-PAYLOAD",
  ].join("\n");
  const stringToSign = [
    "AWS4-HMAC-SHA256",
    amzDate,
    scope,
    sha256Hex(canonicalRequest),
  ].join("\n");
  const signature = signString(config.secretKey, dateStamp, config.region, stringToSign);

  for (const [name, value] of Object.entries(queryParams)) {
    url.searchParams.set(name, value);
  }
  url.searchParams.set("X-Amz-Signature", signature);

  return url.toString();
}

function getAmzDates(date = new Date()) {
  const iso = date.toISOString().replace(/[:-]|\.\d{3}/g, "");
  return {
    amzDate: iso,
    dateStamp: iso.slice(0, 8),
  };
}

function signString(
  secretKey: string,
  dateStamp: string,
  region: string,
  stringToSign: string,
) {
  const dateKey = hmac(`AWS4${secretKey}`, dateStamp);
  const regionKey = hmac(dateKey, region);
  const serviceKey = hmac(regionKey, "s3");
  const signingKey = hmac(serviceKey, "aws4_request");
  return createHmac("sha256", signingKey).update(stringToSign).digest("hex");
}

function hmac(key: string | Buffer, value: string) {
  return createHmac("sha256", key).update(value).digest();
}

function sha256Hex(value: string) {
  return createHash("sha256").update(value).digest("hex");
}

function canonicalHeaders(headers: Record<string, string>) {
  return Object.entries(normalizeHeaders(headers))
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([name, value]) => `${name}:${value.trim().replace(/\s+/g, " ")}`)
    .join("\n")
    .concat("\n");
}

function normalizeHeaders(headers: Record<string, string>) {
  return Object.fromEntries(
    Object.entries(headers).map(([name, value]) => [name.toLowerCase(), value]),
  );
}

function canonicalQueryString(query: Record<string, string>) {
  return Object.entries(query)
    .sort(([aKey, aValue], [bKey, bValue]) =>
      aKey === bKey ? aValue.localeCompare(bValue) : aKey.localeCompare(bKey),
    )
    .map(([key, value]) => `${encodeRfc3986(key)}=${encodeRfc3986(value)}`)
    .join("&");
}

function canonicalUri(pathname: string) {
  return pathname
    .split("/")
    .map((segment) => encodeRfc3986(decodeURIComponent(segment)))
    .join("/");
}

function encodeKey(key: string) {
  return key.split("/").map(encodeURIComponent).join("/");
}

function encodeRfc3986(value: string) {
  return encodeURIComponent(value).replace(/[!'()*]/g, (char) =>
    `%${char.charCodeAt(0).toString(16).toUpperCase()}`,
  );
}

function publicObjectUrl(config: S3Config, key: string) {
  return `${config.publicBaseUrl}/${encodeKey(key)}`;
}

function normalizePrefix(prefix: string) {
  const base = prefix.trim() || DEFAULT_PREFIX;
  return base
    .trim()
    .replace(/^\/+/, "")
    .replace(/\/?$/, "/");
}

function cleanUrl(value?: string) {
  return value?.trim().replace(/\/+$/, "") || "";
}

function normalizeContentType(type: string) {
  return type?.trim() || "application/octet-stream";
}

function safeFileName(name: string) {
  const cleaned = name
    .normalize("NFKD")
    .replace(/[^\w.\-]+/g, "-")
    .replace(/-{2,}/g, "-")
    .replace(/^-|-$/g, "")
    .toLowerCase();
  return cleaned || "media-file";
}
