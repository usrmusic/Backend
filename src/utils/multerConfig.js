import multer from 'multer';
import path from 'path';
import fs from 'fs';

function getUploadsDir() {
  if (process.env.PERSISTENT_UPLOADS_DIR && process.env.PERSISTENT_UPLOADS_DIR.length)
    return path.resolve(process.env.PERSISTENT_UPLOADS_DIR);
  return path.resolve(process.cwd(), 'uploads');
}

export function createUploadMiddleware({ allowedMimeTypes = [], maxBytes, forceDisk = false } = {}) {
  const uploadsDir = getUploadsDir();
  if (!fs.existsSync(uploadsDir)) fs.mkdirSync(uploadsDir, { recursive: true });

  // Use memory storage only for small S3 uploads. Large/media uploads always use
  // disk (forceDisk=true) so a 200 MB file never lands in Node's heap.
  const useMemory = !forceDisk && (process.env.FILE_STORAGE || '').toLowerCase() === 's3';
  const storage = useMemory
    ? multer.memoryStorage()
    : multer.diskStorage({
        destination: function (req, file, cb) {
          cb(null, uploadsDir);
        },
        filename: function (req, file, cb) {
          // Underscore separator (not dash) matches uploadHelper.js's naming —
          // the frontend strips everything before the first underscore to
          // show just the real filename, so both paths must agree on it.
          const name = `${Date.now()}_${file.originalname}`;
          cb(null, name);
        },
      });

  function fileFilter(req, file, cb) {
    if (!allowedMimeTypes || allowedMimeTypes.length === 0) return cb(null, true);
    if (file && file.mimetype && allowedMimeTypes.includes(file.mimetype)) return cb(null, true);
    // A plain Error here fell through errorHandler.js's catch-all as a vague
    // 500 "internal_server_error" — every file type not on the whitelist
    // (HEIC/iPhone photos, .mov, .zip, .csv, PowerPoint, ...) looked like a
    // mystery crash instead of a clear "this file type isn't supported".
    const err = new Error(
      `File type "${file?.mimetype || 'unknown'}" isn't supported for this upload.`,
    );
    err.code = 'INVALID_FILE_TYPE';
    cb(err);
  }

  const limit = maxBytes || parseInt(process.env.MAX_UPLOAD_BYTES || String(10 * 1024 * 1024), 10);
  return multer({ storage, fileFilter, limits: { fileSize: limit } });
}

export const imageUpload = createUploadMiddleware({
  allowedMimeTypes: [
    'image/jpeg',
    'image/png',
    'image/gif',
    'image/webp',
    'image/svg+xml',
  ],
});

export const pdfUpload = createUploadMiddleware({
  allowedMimeTypes: [
    'application/pdf',
    'application/vnd.oasis.opendocument.text',
  ],
});

export const mediaUpload = createUploadMiddleware({
  // Always use disk storage — a 200 MB file must never land in Node's heap.
  // uploadHelper will stream from disk to S3 and delete the temp file after upload.
  forceDisk: true,
  allowedMimeTypes: [
    // images
    'image/jpeg',
    'image/png',
    'image/gif',
    'image/webp',
    'image/svg+xml',
    // pdf / docs / text / spreadsheets
    'application/pdf',
    'application/msword',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/vnd.ms-excel',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'text/plain',
    // audio/video
    'audio/mpeg', // .mp3
    'audio/mp3',
    'audio/wav',
    'video/mp4', // .mp4
    'video/mpeg',
    'video/quicktime',
  ],
  maxBytes: parseInt(process.env.MAX_UPLOAD_BYTES_MEDIA || String(200 * 1024 * 1024), 10), // default 200MB
});

export const fileUpload = createUploadMiddleware({
  allowedMimeTypes: [
    'image/jpeg',
    'image/png',
    'image/jpg',
    'image/webp',
    // iPhone's default photo/video formats — a DJ business fields client
    // and venue photos/videos from phones constantly; rejecting these was
    // effectively rejecting most real-world uploads.
    'image/heic',
    'image/heif',
    'video/quicktime', // .mov
    'application/pdf',
    'application/msword', // .doc
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document', // .docx
    'application/vnd.ms-excel', // .xls
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', // .xlsx
    'application/vnd.ms-powerpoint', // .ppt
    'application/vnd.openxmlformats-officedocument.presentationml.presentation', // .pptx
    'text/plain', // .txt
    'text/csv',
    'application/zip',
    'audio/mpeg',
    'video/mp4',
  ],
  maxBytes: parseInt(process.env.MAX_UPLOAD_BYTES || String(50 * 1024 * 1024), 10), // default 50MB (Laravel parity)
});

export default { createUploadMiddleware, imageUpload, pdfUpload };
