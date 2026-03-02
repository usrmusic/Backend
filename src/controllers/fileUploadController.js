import prisma from '../utils/prismaClient.js';
import catchAsync from '../utils/catchAsync.js';
import { uploadFile, getDownloadUrl } from '../utils/uploadHelper.js';
import { getSignedGetUrl } from '../utils/s3Client.js';
import path from 'path';
import fs from 'fs';
import { logActivity } from '../utils/activityLogger.js';

function getUploadsDir() {
  if (process.env.PERSISTENT_UPLOADS_DIR && process.env.PERSISTENT_UPLOADS_DIR.length)
    return path.resolve(process.env.PERSISTENT_UPLOADS_DIR);
  return path.resolve(process.cwd(), 'uploads');
}

export const listFiles = catchAsync(async (req, res) => {
  const q = {};
  if (req.query.event_id) q.event_id = Number(req.query.event_id);
  const files = await prisma.fileUpload.findMany({ where: q, orderBy: { id: 'desc' } });
  res.json({ data: files });
});

export const getFile = catchAsync(async (req, res) => {
  const id = Number(req.params.id);
  if (!id) return res.status(400).json({ error: 'invalid_id' });
  const f = await prisma.fileUpload.findUnique({ where: { id } });
  if (!f) return res.status(404).json({ error: 'not_found' });
  // Attach download url
  if (process.env.FILE_STORAGE && process.env.FILE_STORAGE.toLowerCase() === 's3') {
    f.download_url = await getSignedGetUrl(f.file_name);
  } else {
    const base = process.env.BASE_URL || '';
    f.download_url = `${base}/uploads/${f.file_name}`;
  }
  res.json({ data: f });
});

export const storeFile = catchAsync(async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'no_file' });
  const { event_id, general, delete_after } = req.body || {};

  const folder = req.body.folder || 'files';
  const uploadRes = await uploadFile(req.file, { folder });

  const fileNameStored = uploadRes && uploadRes.key ? uploadRes.key : (uploadRes && uploadRes.url) || req.file.filename || req.file.originalname;

  const data = {
    file_name: fileNameStored,
    file_type: req.file.mimetype || null,
    event_id: event_id ? Number(event_id) : null,
    general: general === 'true' || general === true ? true : false,
    delete_after: delete_after ? new Date(delete_after) : null,
    created_by: req.user && (req.user.id || req.user.sub) ? Number(req.user.id || req.user.sub) : null,
  };

  const created = await prisma.fileUpload.create({ data });

  try { await logActivity(prisma, { log_name: 'file_uploads', description: 'Uploaded file', subject_type: 'FileUpload', subject_id: created.id, causer_id: req.user?.id || null, properties: { file_name: fileNameStored, event_id: created.event_id } }); } catch(e){}

  // produce download url for response
  let download_url = null;
  if (uploadRes && uploadRes.storage === 's3') {
    download_url = await getSignedGetUrl(uploadRes.key);
  } else {
    const base = process.env.BASE_URL || '';
    download_url = `${base}/uploads/${fileNameStored}`;
  }

  res.status(201).json({ data: created, download_url });
});

export const downloadFile = catchAsync(async (req, res) => {
  const id = Number(req.params.id);
  if (!id) return res.status(400).json({ error: 'invalid_id' });
  const f = await prisma.fileUpload.findUnique({ where: { id } });
  if (!f) return res.status(404).json({ error: 'not_found' });

  if (process.env.FILE_STORAGE && process.env.FILE_STORAGE.toLowerCase() === 's3') {
    const url = await getSignedGetUrl(f.file_name);
    return res.json({ url });
  }

  const uploadsDir = getUploadsDir();
  const p = path.join(uploadsDir, f.file_name);
  if (!fs.existsSync(p)) return res.status(404).json({ error: 'file_not_found' });
  return res.download(p, f.file_name);
});

export default { listFiles, getFile, storeFile, downloadFile };
