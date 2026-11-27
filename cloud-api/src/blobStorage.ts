import {
  BlobSASPermissions,
  BlobServiceClient,
  ContainerClient,
  generateBlobSASQueryParameters,
  StorageSharedKeyCredential,
} from '@azure/storage-blob';
import { config } from './config';

let containerClient: ContainerClient | null = null;
let sharedKeyCredential: StorageSharedKeyCredential | null = null;
let containerEnsured = false;

function parseConnectionString(connStr: string): { accountName?: string; accountKey?: string } {
  const parts: Record<string, string> = {};
  for (const segment of connStr.split(';')) {
    const idx = segment.indexOf('=');
    if (idx > 0) {
      const k = segment.slice(0, idx).trim();
      const v = segment.slice(idx + 1).trim();
      parts[k] = v;
    }
  }
  return {
    accountName: parts.AccountName,
    accountKey: parts.AccountKey,
  };
}

function getContainerClient(): ContainerClient | null {
  if (!config.azureStorageConnectionString) return null;
  if (!containerClient) {
    const serviceClient = BlobServiceClient.fromConnectionString(
      config.azureStorageConnectionString
    );
    containerClient = serviceClient.getContainerClient(config.azureStorageContainer);
    const parsed = parseConnectionString(config.azureStorageConnectionString);
    if (parsed.accountName && parsed.accountKey) {
      sharedKeyCredential = new StorageSharedKeyCredential(
        parsed.accountName,
        parsed.accountKey
      );
    }
  }
  return containerClient;
}

export async function ensureBlobContainer(): Promise<ContainerClient | null> {
  const client = getContainerClient();
  if (!client) return null;
  if (!containerEnsured) {
    await client.createIfNotExists();
    containerEnsured = true;
  }
  return client;
}

export function decodeBase64Jpeg(base64Input: string): Buffer {
  const cleaned = base64Input.includes('base64,')
    ? base64Input.slice(base64Input.indexOf('base64,') + 7)
    : base64Input;
  return Buffer.from(cleaned.replace(/[^A-Za-z0-9+/=]/g, ''), 'base64');
}

export async function uploadSnapshotBlob(
  userId: number,
  base64Jpeg: string
): Promise<string | null> {
  const client = await ensureBlobContainer();
  if (!client) return null;
  const buffer = decodeBase64Jpeg(base64Jpeg);
  if (!buffer.length) return null;

  const blobName = `user-${userId}/scan_${Date.now()}_${Math.floor(Math.random() * 100000)}.jpg`;
  const blockBlob = client.getBlockBlobClient(blobName);
  await blockBlob.uploadData(buffer, {
    blobHTTPHeaders: {
      blobContentType: 'image/jpeg',
      blobCacheControl: 'private, max-age=86400',
    },
  });
  return blobName;
}

export function getSnapshotReadUrl(blobName: string | null | undefined): string | null {
  if (!blobName) return null;
  if (blobName.startsWith('http://') || blobName.startsWith('https://')) {
    return blobName;
  }
  const client = getContainerClient();
  if (!client) return null;
  const blobClient = client.getBlobClient(blobName);

  if (sharedKeyCredential) {
    const startsOn = new Date(Date.now() - 5 * 60 * 1000);
    const expiresOn = new Date(Date.now() + 24 * 60 * 60 * 1000);
    const sas = generateBlobSASQueryParameters(
      {
        containerName: config.azureStorageContainer,
        blobName,
        permissions: BlobSASPermissions.parse('r'),
        startsOn,
        expiresOn,
      },
      sharedKeyCredential
    ).toString();
    return `${blobClient.url}?${sas}`;
  }
  return blobClient.url;
}

export async function deleteSnapshotBlob(blobName: string | null | undefined): Promise<void> {
  if (!blobName) return;
  try {
    const client = await ensureBlobContainer();
    if (!client) return;
    await client.getBlobClient(blobName).deleteIfExists();
  } catch {
    // Ignore missing blob error
  }
}

export async function getBlobStorageStats(): Promise<{ photoCount: number; photoBytes: number }> {
  try {
    const client = await ensureBlobContainer();
    if (!client) return { photoCount: 0, photoBytes: 0 };
    let photoCount = 0;
    let photoBytes = 0;
    for await (const blob of client.listBlobsFlat()) {
      photoCount++;
      photoBytes += Number(blob.properties.contentLength || 0);
    }
    return { photoCount, photoBytes };
  } catch {
    return { photoCount: 0, photoBytes: 0 };
  }
}

export async function cleanOrphanSnapshotBlobs(activeBlobNames: Set<string>): Promise<number> {
  try {
    const client = await ensureBlobContainer();
    if (!client) return 0;
    let removed = 0;
    for await (const blob of client.listBlobsFlat()) {
      if (!activeBlobNames.has(blob.name)) {
        await client.getBlobClient(blob.name).deleteIfExists();
        removed++;
      }
    }
    return removed;
  } catch {
    return 0;
  }
}

export interface SnapshotBlobItem {
  name: string;
  sizeBytes: number;
  lastModified: string | null;
  url: string | null;
}

export async function listSnapshotBlobs(limit = 300): Promise<SnapshotBlobItem[]> {
  try {
    const client = await ensureBlobContainer();
    if (!client) return [];
    const items: Array<SnapshotBlobItem & { sortTs: number }> = [];
    for await (const blob of client.listBlobsFlat()) {
      const lm = blob.properties.lastModified || null;
      items.push({
        name: blob.name,
        sizeBytes: Number(blob.properties.contentLength || 0),
        lastModified: lm instanceof Date ? lm.toISOString() : lm ? String(lm) : null,
        url: getSnapshotReadUrl(blob.name),
        sortTs: lm instanceof Date ? lm.getTime() : 0,
      });
    }
    items.sort((a, b) => b.sortTs - a.sortTs);
    return items.slice(0, Math.max(1, limit)).map(({ sortTs: _ignored, ...rest }) => rest);
  } catch {
    return [];
  }
}
