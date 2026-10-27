import 'server-only';
import { createHash, randomUUID } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { mkdir, readFile, unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { Readable } from 'node:stream';
import { env, isProduction } from '@/lib/env';
import { prisma } from '@/lib/db';
import { logger } from '@/lib/logger';
import { signPayload, verifySignedPayload } from '@/lib/auth/crypto';

/**
 * Private object storage.
 *
 * Two drivers behind one interface:
 *   • `s3`    — an S3-compatible private bucket (production).
 *   • `local` — the `.storage/` directory (development only).
 *
 * Neither ever exposes a public URL. Downloads always go through
 * `/api/files/[id]/download`, which authorizes the request first and then
 * streams the bytes. Storage keys are opaque UUID paths and are never
 * returned to the browser.
 */

const LOCAL_ROOT = path.resolve(process.cwd(), '.storage');

export interface StoredObject {
  storageKey: string;
  byteSize: number;
  checksum: string;
}

function buildStorageKey(workspaceId: string, originalName: string): string {
  const ext = path.extname(originalName).toLowerCase().slice(0, 12);
  const safeExt = /^\.[a-z0-9]+$/.test(ext) ? ext : '';
  // Date-partitioned so a bucket listing stays navigable, UUID-named so the
  // key reveals nothing about the file or the client it belongs to.
  const now = new Date();
  const partition = `${now.getUTCFullYear()}/${String(now.getUTCMonth() + 1).padStart(2, '0')}`;
  return `workspaces/${workspaceId}/${partition}/${randomUUID()}${safeExt}`;
}

// ---------------------------------------------------------------------------
// Driver: local filesystem
// ---------------------------------------------------------------------------

function localPathFor(storageKey: string): string {
  const resolved = path.resolve(LOCAL_ROOT, storageKey);
  // Defence against a crafted key escaping the storage root.
  if (!resolved.startsWith(LOCAL_ROOT + path.sep)) {
    throw new Error('Invalid storage key');
  }
  return resolved;
}

async function localPut(storageKey: string, body: Buffer): Promise<void> {
  const target = localPathFor(storageKey);
  await mkdir(path.dirname(target), { recursive: true });
  await writeFile(target, body);
}

async function localGet(storageKey: string): Promise<Buffer> {
  return readFile(localPathFor(storageKey));
}

async function localDelete(storageKey: string): Promise<void> {
  await unlink(localPathFor(storageKey)).catch(() => undefined);
}

function localStream(storageKey: string): ReadableStream<Uint8Array> {
  return Readable.toWeb(createReadStream(localPathFor(storageKey))) as ReadableStream<Uint8Array>;
}

// ---------------------------------------------------------------------------
// Driver: S3
// ---------------------------------------------------------------------------

type S3Module = typeof import('@aws-sdk/client-s3');
let s3Client: InstanceType<S3Module['S3Client']> | null = null;
let s3Module: S3Module | null = null;

async function getS3() {
  if (!s3Module) s3Module = await import('@aws-sdk/client-s3');
  if (!s3Client) {
    s3Client = new s3Module.S3Client({
      region: env.S3_REGION,
      ...(env.S3_ENDPOINT ? { endpoint: env.S3_ENDPOINT } : {}),
      forcePathStyle: env.S3_FORCE_PATH_STYLE,
      credentials: {
        accessKeyId: env.S3_ACCESS_KEY_ID as string,
        secretAccessKey: env.S3_SECRET_ACCESS_KEY as string,
      },
    });
  }
  return { client: s3Client, mod: s3Module };
}

// ---------------------------------------------------------------------------
// Public interface
// ---------------------------------------------------------------------------

export async function putObject(
  workspaceId: string,
  originalName: string,
  body: Buffer,
): Promise<StoredObject> {
  const storageKey = buildStorageKey(workspaceId, originalName);
  const checksum = createHash('sha256').update(body).digest('hex');

  if (env.STORAGE_DRIVER === 's3') {
    const { client, mod } = await getS3();
    await client.send(
      new mod.PutObjectCommand({
        Bucket: env.S3_BUCKET as string,
        Key: storageKey,
        Body: body,
        // Private is the default, but state it so a bucket policy change
        // cannot silently make objects readable.
        ACL: 'private',
        ServerSideEncryption: 'AES256',
      }),
    );
  } else {
    await localPut(storageKey, body);
  }

  return { storageKey, byteSize: body.byteLength, checksum };
}

export async function getObject(storageKey: string): Promise<Buffer> {
  if (env.STORAGE_DRIVER === 's3') {
    const { client, mod } = await getS3();
    const result = await client.send(
      new mod.GetObjectCommand({ Bucket: env.S3_BUCKET as string, Key: storageKey }),
    );
    const bytes = await result.Body?.transformToByteArray();
    if (!bytes) throw new Error('Empty object body');
    return Buffer.from(bytes);
  }
  return localGet(storageKey);
}

export async function getObjectStream(storageKey: string): Promise<ReadableStream<Uint8Array>> {
  if (env.STORAGE_DRIVER === 's3') {
    const { client, mod } = await getS3();
    const result = await client.send(
      new mod.GetObjectCommand({ Bucket: env.S3_BUCKET as string, Key: storageKey }),
    );
    const body = result.Body as { transformToWebStream?: () => ReadableStream<Uint8Array> };
    if (!body?.transformToWebStream) throw new Error('Object body is not streamable');
    return body.transformToWebStream();
  }
  return localStream(storageKey);
}

export async function deleteObject(storageKey: string): Promise<void> {
  if (env.STORAGE_DRIVER === 's3') {
    const { client, mod } = await getS3();
    await client.send(
      new mod.DeleteObjectCommand({ Bucket: env.S3_BUCKET as string, Key: storageKey }),
    );
    return;
  }
  await localDelete(storageKey);
}

/**
 * Short-lived, signed download token.
 *
 * Used for links that must survive a page navigation (a PDF opened in a new
 * tab). The token names the file and the user it was minted for; the download
 * route still re-checks the session and object-level permission, so a leaked
 * token alone is not enough.
 */
const DOWNLOAD_TOKEN_TTL_SECONDS = 300;

export function createDownloadToken(fileId: string, userId: string): string {
  return signPayload(
    { fileId, userId, exp: Math.floor(Date.now() / 1000) + DOWNLOAD_TOKEN_TTL_SECONDS },
    'file-download',
  );
}

export function verifyDownloadToken(token: string): { fileId: string; userId: string } | null {
  const payload = verifySignedPayload<{ fileId: string; userId: string; exp: number }>(
    token,
    'file-download',
  );
  if (!payload) return null;
  if (payload.exp * 1000 < Date.now()) return null;
  return { fileId: payload.fileId, userId: payload.userId };
}

/**
 * Store an artifact the application generated itself (an invoice PDF, an
 * export) and register it as a FileAsset so it inherits the same access
 * control and audit trail as an upload.
 */
export async function storeGeneratedFile(params: {
  workspaceId: string;
  uploadedById: string;
  buffer: Buffer;
  originalName: string;
  mimeType: string;
  clientId?: string | null;
  projectId?: string | null;
}) {
  const stored = await putObject(params.workspaceId, params.originalName, params.buffer);

  return prisma.fileAsset.create({
    data: {
      workspaceId: params.workspaceId,
      clientId: params.clientId ?? null,
      projectId: params.projectId ?? null,
      uploadedById: params.uploadedById,
      storageKey: stored.storageKey,
      originalName: params.originalName,
      mimeType: params.mimeType,
      byteSize: stored.byteSize,
      checksum: stored.checksum,
      // Generated in-process from our own data, so there is nothing to scan.
      scanStatus: 'SKIPPED',
      scanNote: 'Generated by Nexora OS',
      isSystem: true,
      category: 'Generated',
    },
    select: { id: true, storageKey: true },
  });
}

/** Reported on the Settings page so nobody assumes S3 is wired up when it is not. */
export function storageStatus(): { driver: string; description: string; productionReady: boolean } {
  if (env.STORAGE_DRIVER === 's3') {
    return {
      driver: 's3',
      description: `S3-compatible bucket "${env.S3_BUCKET}" in ${env.S3_REGION}. Objects are private and server-side encrypted.`,
      productionReady: true,
    };
  }
  if (isProduction) {
    logger.warn('STORAGE_DRIVER=local in production — files live on the app server disk.');
  }
  return {
    driver: 'local',
    description:
      'Local filesystem (./.storage). Intended for development only — files are not replicated or backed up.',
    productionReady: false,
  };
}
