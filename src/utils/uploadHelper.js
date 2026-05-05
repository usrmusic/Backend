import path from 'path';
import fs from 'fs';
import stream from 'stream';
import crypto from 'crypto';
import { uploadStreamToS3, getSignedGetUrl, deleteObjectFromS3 } from './s3Client.js';

// Upload helper for Railway persistent volumes or local fallback.
// Set `PERSISTENT_UPLOADS_DIR` to the mounted Railway volume path (e.g. /data/uploads).
// The server will expose that directory at `/uploads`.

function getUploadsDir() {
  if (process.env.PERSISTENT_UPLOADS_DIR && process.env.PERSISTENT_UPLOADS_DIR.length)
    return path.resolve(process.env.PERSISTENT_UPLOADS_DIR);
  return path.resolve(process.cwd(), 'uploads');
}

export async function uploadFile(file, options = {}) {
  if (!file) return null;
  const { allowedMimeTypes, folder } = options;
  const deleteAfter = options.deleteAfter || options.delete_after || null;
  if (allowedMimeTypes && Array.isArray(allowedMimeTypes)) {
    if (!file.mimetype || !allowedMimeTypes.includes(file.mimetype)) {
      const e = new Error('invalid_file_type');
      e.name = 'InvalidFileType';
      throw e;
    }
  }

  const uploadsDir = getUploadsDir();
  if (!fs.existsSync(uploadsDir)) fs.mkdirSync(uploadsDir, { recursive: true });

  // S3 storage if enabled
  const storageMode = (process.env.FILE_STORAGE || '').toLowerCase();
  const targetFolder = folder && folder.length ? folder.replace(/^\/+|\/+$/g, '') : 'uploads';
  if (storageMode === 's3') {
    const ext = path.extname(file.originalname || '') || '';
    const shortName = `${Date.now()}-${crypto.randomBytes(6).toString('hex')}${ext}`;
    const key = `${targetFolder}/${shortName}`;
    // file.path (disk) -> stream, file.buffer -> buffer
    if (file.path) {
      const fileStream = fs.createReadStream(file.path);
      await uploadStreamToS3(fileStream, key, file.mimetype || 'application/octet-stream', { metadata: deleteAfter ? { delete_after: (new Date(deleteAfter)).toISOString() } : undefined, tags: deleteAfter ? { delete_after: (new Date(deleteAfter)).toISOString() } : undefined });
    } else if (file.buffer) {
      await uploadStreamToS3(file.buffer, key, file.mimetype || 'application/octet-stream', { metadata: deleteAfter ? { delete_after: (new Date(deleteAfter)).toISOString() } : undefined, tags: deleteAfter ? { delete_after: (new Date(deleteAfter)).toISOString() } : undefined });
    } else {
      throw new Error('No file data to upload');
    }
    return { url: key, storage: 's3', key };
  }

  // If multer already stored the file on disk, move/copy it into uploadsDir if needed (local)
  if (file.path) {
    const filename = path.basename(file.path);
    const folderPath = folder && folder.length ? path.join(uploadsDir, folder) : uploadsDir;
    if (!fs.existsSync(folderPath)) fs.mkdirSync(folderPath, { recursive: true });
    const target = path.join(folderPath, filename);
    if (path.resolve(file.path) !== path.resolve(target)) {
      // move the file into uploadsDir
      try {
        await fs.promises.rename(file.path, target);
      } catch (e) {
        // fallback to copy
        await fs.promises.copyFile(file.path, target);
      }
    }
    const base = process.env.BASE_URL || '';
    const rel = folder && folder.length ? `${folder}/${filename}` : `${filename}`;
    // write metadata file if deleteAfter provided
    if (deleteAfter) {
      try {
        const metaPath = path.join(folderPath, `${filename}.meta.json`);
        await fs.promises.writeFile(metaPath, JSON.stringify({ delete_after: (new Date(deleteAfter)).toISOString() }));
      } catch (e) {}
    }
    return { url: `${base}/uploads/${rel}`, storage: 'local', key: rel };
  }

  // If buffer provided (memory storage)
  if (file.buffer) {
    const ext = path.extname(file.originalname || '') || '';
    const name = `${Date.now()}-${crypto.randomBytes(6).toString('hex')}${ext}`;
    const folderPath = folder && folder.length ? path.join(uploadsDir, folder) : uploadsDir;
    if (!fs.existsSync(folderPath)) fs.mkdirSync(folderPath, { recursive: true });
    const outPath = path.join(folderPath, name);
    await fs.promises.writeFile(outPath, file.buffer);
    if (deleteAfter) {
      try { await fs.promises.writeFile(`${outPath}.meta.json`, JSON.stringify({ delete_after: (new Date(deleteAfter)).toISOString() })); } catch(e){}
    }
    const base = process.env.BASE_URL || '';
    const rel = folder && folder.length ? `${folder}/${name}` : name;
    return { url: `${base}/uploads/${rel}`, storage: 'local', key: rel };
  }

  return null;
}

export default uploadFile;

export async function getDownloadUrl(fileKey, opts = {}) {
  // If s3 storage, return presigned URL
  if ((process.env.FILE_STORAGE || '').toLowerCase() === 's3') {
    const expires = opts.expiresInSeconds || 60 * 60 * 24 * 7; // default 7 days
    return await getSignedGetUrl(fileKey, expires);
  }
  // For local storage, return base URL path
  const base = process.env.BASE_URL || '';
  return `${base}/uploads/${fileKey}`;
}

// Remove expired files whose `delete_after` is past. This deletes the object from storage and removes the fileUpload row.
export async function pruneExpiredFiles(prismaClient) {
  if (!prismaClient) throw new Error('prismaClient_required');
  const now = new Date();
  const expired = await prismaClient.fileUpload.findMany({ where: { delete_after: { lte: now } } }).catch(()=>[]);
  for (const f of expired) {
    try {
      if ((process.env.FILE_STORAGE || '').toLowerCase() === 's3') {
        await deleteObjectFromS3(f.file_name).catch(()=>{});
      } else {
        const uploadsDir = getUploadsDir();
        const p = path.join(uploadsDir, f.file_name);
        try { if (fs.existsSync(p)) await fs.promises.unlink(p); } catch(e){}
        try { const meta = `${p}.meta.json`; if (fs.existsSync(meta)) await fs.promises.unlink(meta); } catch(e){}
      }
      await prismaClient.fileUpload.delete({ where: { id: f.id } }).catch(()=>{});
    } catch (e) {
      // swallow per-file errors
    }
  }
  return expired.length;
}
