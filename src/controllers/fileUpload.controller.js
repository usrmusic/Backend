import prisma from "../utils/prismaClient.js";
import catchAsync from "../utils/catchAsync.js";
import { uploadFile, getDownloadUrl } from "../utils/uploadHelper.js";
import { getSignedGetUrl } from "../utils/s3Client.js";
import path from "path";
import fs from "fs";
import services from "../services/index.js";
import { serializeForJson } from "../utils/serialize.js";

const fileSvc = services.get("FileUpload");
const mediaSvc = services.get("Media");

function getUploadsDir() {
  if (
    process.env.PERSISTENT_UPLOADS_DIR &&
    process.env.PERSISTENT_UPLOADS_DIR.length
  )
    return path.resolve(process.env.PERSISTENT_UPLOADS_DIR);
  return path.resolve(process.cwd(), "uploads");
}

export const listFiles = catchAsync(async (req, res) => {
  // Build filter from query params
  let filter = {};
  if (req.query.filter) {
    try {
      const parsed =
        typeof req.query.filter === "string"
          ? JSON.parse(req.query.filter)
          : req.query.filter;
      filter = { ...filter, ...parsed };
    } catch (e) {
      // ignore invalid JSON filter
    }
  }

  // simple search on filename
  if (req.query.search) filter.file_name = { contains: req.query.search };
  if (req.query.event_id) filter.event_id = Number(req.query.event_id);

  const perPage = Number(req.query.perPage || req.query.limit || 25);
  const page = Number(req.query.page || 1);
  const sort =
    req.query.sort ||
    (req.query.sort_by
      ? `${req.query.sort_by}:${req.query.sort_dir || "asc"}`
      : undefined);

  const files = await fileSvc.list({ filter, perPage, page, sort });
  const count = await fileSvc.model.count({ where: filter });
  const totalPages = perPage > 0 ? Math.ceil(count / perPage) : 1;

  res.json({
    data: serializeForJson(files),
    meta: { total: count, perPage, page, totalPages },
  });
});

export const getFile = catchAsync(async (req, res) => {
  const id = Number(req.params.id);
  if (!id) return res.status(400).json({ error: "invalid_id" });
  const f = await fileSvc.getById(id);
  if (!f) return res.status(404).json({ error: "not_found" });
  // Attach download url
  if (
    process.env.FILE_STORAGE &&
    process.env.FILE_STORAGE.toLowerCase() === "s3"
  ) {
    f.download_url = await getSignedGetUrl(f.file_name);
  } else {
    const base = process.env.BASE_URL || "";
    f.download_url = `${base}/uploads/${f.file_name}`;
  }
  res.json({ data: f });
});

const updateFileMetadata = catchAsync(async (req, res) => {
  const id = Number(req.params.id || req.query.id);
  const { file_name } = req.body;
  const f = await prisma.fileUpload.findUnique({ where: { id } });
  if (!f) return res.status(404).json({ error: "not_found" });
  const updated = await prisma.fileUpload.update({
    where: { id },
    data: { file_name },
  });
  res.json({ data: updated });
});
// Compatibility handler used by routes: mirrors Laravel flow (default delete-after, signed URLs)
export const uploadfile = catchAsync(async (req, res) => {
  if (!req.file) return res.status(400).json({ error: "no_file" });
  const { event_id, general, delete_after, folder } = req.body || {};

  // default delete_after to one week if not provided
  const deleteAfter = delete_after
    ? new Date(delete_after)
    : new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);

  // validate provided event_id (if any)
  if (event_id) {
    const ev = await prisma.event.findUnique({
      where: { id: Number(event_id) },
    });
    if (!ev) return res.status(400).json({ error: "invalid_event_id" });
  }

  const uploadRes = await uploadFile(req.file, {
    folder: folder || "files",
    deleteAfter,
  });

  const fileNameStored =
    uploadRes && uploadRes.key
      ? uploadRes.key
      : (uploadRes && uploadRes.url) ||
        req.file.filename ||
        req.file.originalname;

  const data = {
    file_name: fileNameStored,
    file_type: req.file.mimetype || null,
    event_id: event_id ? Number(event_id) : null,
    general: general === "true" || general === true ? true : false,
    delete_after: deleteAfter || null,
    created_by:
      req.user && (req.user.id || req.user.sub)
        ? Number(req.user.id || req.user.sub)
        : null,
  };

  const created = await prisma.fileUpload.create({ data });
  // produce download url for response
  let download_url = null;
  if (uploadRes && uploadRes.storage === "s3") {
    download_url = await getSignedGetUrl(uploadRes.key);
  } else if (uploadRes && uploadRes.url) {
    // upload helper already produced a full URL for local storage
    download_url = uploadRes.url;
  } else {
    // fallback: construct download url from key/name
    download_url = await getDownloadUrl(fileNameStored);
  }

  // return created record and download url (and storage info)
  res.status(201).json({
    data: created,
    download_url,
    storage: uploadRes && uploadRes.storage ? uploadRes.storage : "local",
  });
});

const deleteFile = catchAsync(async (req, res) => {
  const id = Number(req.params.id || req.query.id);
  const f = await prisma.fileUpload.findUnique({ where: { id } });
  if (!f) return res.status(404).json({ error: "not_found" });
  // delete from storage
  if (
    process.env.FILE_STORAGE &&
    process.env.FILE_STORAGE.toLowerCase() === "s3"
  ) {
    await services.get("s3").deleteFile(f.file_name);
  } else {
    const uploadsDir = getUploadsDir();
    const p = path.join(uploadsDir, f.file_name);
    if (fs.existsSync(p)) fs.unlinkSync(p);
  }
  // delete DB record
  await prisma.fileUpload.delete({ where: { id } });
  res.json({ success: true });
});

export const downloadFile = catchAsync(async (req, res) => {
  const id = Number(req.params.id || req.query.id);
  const f = await prisma.fileUpload.findUnique({ where: { id } });
  if (!f) return res.status(404).json({ error: "not_found" });

  if (
    process.env.FILE_STORAGE &&
    process.env.FILE_STORAGE.toLowerCase() === "s3"
  ) {
    const url = await getSignedGetUrl(f.file_name);
    return res.json({ url });
  }

  const uploadsDir = getUploadsDir();
  const p = path.join(uploadsDir, f.file_name);
  if (!fs.existsSync(p))
    return res.status(404).json({ error: "file_not_found" });
  return res.download(p, f.file_name);
});


export const listMedia = catchAsync(async (req, res) => {
  // Build filter from query params
  let filter = {};
  if (req.query.filter) {
    try {
      const parsed =
        typeof req.query.filter === "string"
          ? JSON.parse(req.query.filter)
          : req.query.filter;
      filter = { ...filter, ...parsed };
    } catch (e) {
      // ignore invalid JSON filter
    }
  }

  // simple search on filename
  if (req.query.search) filter.display_name = { contains: req.query.search };

  const perPage = Number(req.query.perPage || req.query.limit || 25);
  const page = Number(req.query.page || 1);
  const sort =
    req.query.sort ||
    (req.query.sort_by
      ? `${req.query.sort_by}:${req.query.sort_dir || "asc"}`
      : undefined);

  const files = await mediaSvc.list({ filter, perPage, page, sort });
  const count = await mediaSvc.model.count({ where: filter });
  const totalPages = perPage > 0 ? Math.ceil(count / perPage) : 1;

  res.json({
    data: serializeForJson(files),
    meta: { total: count, perPage, page, totalPages },
  });
});

const uploadMedia = catchAsync(async (req, res) => {
  // multer may populate `req.file` (single) or `req.files` (fields).
  if (!req.file && req.files) {
    if (req.files.media && req.files.media.length) req.file = req.files.media[0];
    else if (req.files.file && req.files.file.length) req.file = req.files.file[0];
  }
  if (!req.file) return res.status(400).json({ error: "no_file" });

  // Enforce max size ~200MB (Laravel uses max:204800 kilobytes)
  const MAX_BYTES = 204800 * 1024; // 204800 KB
  const fileSize = req.file.size || (req.file.path ? fs.statSync(req.file.path).size : 0);
  if (fileSize > MAX_BYTES) return res.status(422).json({ error: "file_too_large" });

  // Use upload helper to persist the file under `media/`
  const uploadRes = await uploadFile(req.file, { folder: "media" });

  // Derive stored filename (basename) and extension
  const storedKey = uploadRes && uploadRes.key ? uploadRes.key : (uploadRes && uploadRes.url) || req.file.filename || req.file.originalname;
  const storedName = path.basename(storedKey);
  const extension = path.extname(storedName).replace(/^\./, "") || null;

  const data = {
    display_name: req.body.custom_name || req.file.originalname || storedName,
    stored_name: storedName,
    extension: extension,
    mime_type: req.file.mimetype || null,
    size: Number(fileSize) || null,
  };

  const created = await mediaSvc.create(data);

  return res.status(201).json({
    success: true,
    message: "Media uploaded successfully!",
    data: serializeForJson(created),
  });
});

const downloadMedia = catchAsync(async (req, res) => {
  const id = Number(req.params.id || req.query.id);
  if (!id) return res.status(400).json({ error: 'invalid_id' });

  const m = await mediaSvc.getById(id);
  if (!m) return res.status(404).json({ error: 'not_found' });

  // If using S3, construct key (allow stored_name to already contain folder)
  if ((process.env.FILE_STORAGE || '').toLowerCase() === 's3') {
    let key = m.stored_name || '';
    if (!key) return res.status(404).json({ error: 'file_not_found' });
    if (!key.includes('/')) key = `media/${key}`;
    const url = await getSignedGetUrl(key);
    return res.json({ url, storage: 's3' });
  }

  // Local storage: expose via uploads path (uploadHelper uses uploads/<folder>/<name>)
  const base = process.env.BASE_URL || '';
  const rel = m.stored_name && m.stored_name.includes('/') ? m.stored_name : `media/${m.stored_name}`;
  const url = `${base}/uploads/${rel}`;
  return res.json({ url, storage: 'local' });
});

export default {
  listFiles,
  getFile,
  uploadfile,
  updateFileMetadata,
  downloadFile,
  deleteFile,
  listMedia,
  uploadMedia,
  downloadMedia
};
