import { createHash, createHmac } from 'node:crypto';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import type { Config } from '../config';

/** Where uploaded files live: a directory on disk, or an S3-compatible bucket (AWS, MinIO, R2…). */
export interface Storage {
  readonly driver: 'local' | 's3';
  put(key: string, data: Buffer, contentType: string): Promise<void>;
  get(key: string): Promise<Buffer | null>;
  delete(key: string): Promise<void>;
}

export function createStorage(config: Config): Storage {
  return config.STORAGE_DRIVER === 's3' ? s3Storage(config) : localStorage(config.STORAGE_DIR);
}

function localStorage(root: string): Storage {
  const base = resolve(root);
  const path = (key: string) => {
    const full = resolve(join(base, key));
    if (!full.startsWith(base + '/')) throw new Error('Invalid storage key');
    return full;
  };
  return {
    driver: 'local',
    async put(key, data) {
      const file = path(key);
      await mkdir(dirname(file), { recursive: true });
      await writeFile(file, data);
    },
    async get(key) {
      try {
        return await readFile(path(key));
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
        throw error;
      }
    },
    async delete(key) {
      await rm(path(key), { force: true });
    },
  };
}

// ---------------------------------------------------------------------------
// S3 (AWS Signature Version 4, no SDK)
// ---------------------------------------------------------------------------

const hex = (data: Buffer | string) => createHash('sha256').update(data).digest('hex');
const hmac = (key: Buffer | string, data: string) => createHmac('sha256', key).update(data).digest();
const encodePath = (path: string) =>
  path
    .split('/')
    .map((p) =>
      encodeURIComponent(p).replace(/[!'()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`),
    )
    .join('/');

export interface SignInput {
  method: string;
  url: URL;
  headers: Record<string, string>;
  payloadHash: string;
  region: string;
  accessKeyId: string;
  secretAccessKey: string;
  /** "20130524T000000Z" */
  amzDate: string;
}

/** The Authorization header for a request (exported for the test vector). */
export function signV4(input: SignInput): string {
  const date = input.amzDate.slice(0, 8);
  const headers = Object.entries({ ...input.headers, host: input.url.host })
    .map(([k, v]) => [k.toLowerCase(), v.trim()] as const)
    .sort(([a], [b]) => (a < b ? -1 : 1));
  const signedHeaders = headers.map(([k]) => k).join(';');
  const query = [...input.url.searchParams]
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`)
    .sort()
    .join('&');
  const canonical = [
    input.method,
    encodePath(decodeURIComponent(input.url.pathname)),
    query,
    headers.map(([k, v]) => `${k}:${v}\n`).join(''),
    signedHeaders,
    input.payloadHash,
  ].join('\n');
  const scope = `${date}/${input.region}/s3/aws4_request`;
  const toSign = ['AWS4-HMAC-SHA256', input.amzDate, scope, hex(canonical)].join('\n');
  const key = hmac(
    hmac(hmac(hmac(`AWS4${input.secretAccessKey}`, date), input.region), 's3'),
    'aws4_request',
  );
  const signature = createHmac('sha256', key).update(toSign).digest('hex');
  return `AWS4-HMAC-SHA256 Credential=${input.accessKeyId}/${scope}, SignedHeaders=${signedHeaders}, Signature=${signature}`;
}

function s3Storage(config: Config): Storage {
  const { S3_ENDPOINT, S3_BUCKET, S3_REGION, S3_ACCESS_KEY_ID, S3_SECRET_ACCESS_KEY } = config;
  if (!S3_BUCKET || !S3_ACCESS_KEY_ID || !S3_SECRET_ACCESS_KEY)
    throw new Error('STORAGE_DRIVER=s3 needs S3_BUCKET, S3_ACCESS_KEY_ID and S3_SECRET_ACCESS_KEY');
  const endpoint = new URL(S3_ENDPOINT ?? `https://s3.${S3_REGION}.amazonaws.com`);
  const url = (key: string) =>
    config.S3_FORCE_PATH_STYLE
      ? new URL(`${endpoint.origin}/${S3_BUCKET}/${encodePath(key)}`)
      : new URL(`${endpoint.protocol}//${S3_BUCKET}.${endpoint.host}/${encodePath(key)}`);

  async function send(method: string, key: string, body?: Buffer, contentType?: string) {
    const target = url(key);
    const payloadHash = hex(body ?? '');
    const amzDate = new Date()
      .toISOString()
      .replace(/[-:]/g, '')
      .replace(/\.\d{3}/, '');
    const headers: Record<string, string> = {
      'x-amz-content-sha256': payloadHash,
      'x-amz-date': amzDate,
      ...(contentType ? { 'content-type': contentType } : {}),
    };
    headers.authorization = signV4({
      method,
      url: target,
      headers,
      payloadHash,
      region: S3_REGION,
      accessKeyId: S3_ACCESS_KEY_ID!,
      secretAccessKey: S3_SECRET_ACCESS_KEY!,
      amzDate,
    });
    return fetch(target, { method, headers, body });
  }

  return {
    driver: 's3',
    async put(key, data, contentType) {
      const res = await send('PUT', key, data, contentType);
      if (!res.ok) throw new Error(`S3 upload failed: ${res.status} ${await res.text()}`);
    },
    async get(key) {
      const res = await send('GET', key);
      if (res.status === 404) return null;
      if (!res.ok) throw new Error(`S3 download failed: ${res.status}`);
      return Buffer.from(await res.arrayBuffer());
    },
    async delete(key) {
      const res = await send('DELETE', key);
      if (!res.ok && res.status !== 404) throw new Error(`S3 delete failed: ${res.status}`);
    },
  };
}
