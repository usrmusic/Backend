import path from 'path';
import fs from 'fs';

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
  const { allowedMimeTypes } = options;
  if (allowedMimeTypes && Array.isArray(allowedMimeTypes)) {
    if (!file.mimetype || !allowedMimeTypes.includes(file.mimetype)) {
      const e = new Error('invalid_file_type');
      e.name = 'InvalidFileType';
      throw e;
    }
  }

  const uploadsDir = getUploadsDir();
  if (!fs.existsSync(uploadsDir)) fs.mkdirSync(uploadsDir, { recursive: true });

  // If multer already stored the file on disk, move/copy it into uploadsDir if needed
  if (file.path) {
    const filename = path.basename(file.path);
    const target = path.join(uploadsDir, filename);
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
    return { url: `${base}/uploads/${filename}`, storage: 'local', key: filename };
  }

  // If buffer provided (memory storage)
  if (file.buffer) {
    const name = `${Date.now()}-${file.originalname}`;
    const outPath = path.join(uploadsDir, name);
    await fs.promises.writeFile(outPath, file.buffer);
    const base = process.env.BASE_URL || '';
    return { url: `${base}/uploads/${name}`, storage: 'local', key: name };
  }

  return null;
}

export default uploadFile;
