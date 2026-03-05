import prisma from "../utils/prismaClient.js";
import catchAsync from "../utils/catchAsync.js";
import { uploadFile } from "../utils/uploadHelper.js";
import { deleteObjectFromS3 } from "../utils/s3Client.js";
import { serializeForJson } from "../utils/serialize.js";
import path from "path";
import fs from "fs";
import services from "../services/index.js";

const companySvc = services.get("CompanyName");


function getUploadsDir() {
  if (process.env.PERSISTENT_UPLOADS_DIR && process.env.PERSISTENT_UPLOADS_DIR.length)
    return path.resolve(process.env.PERSISTENT_UPLOADS_DIR);
  return path.resolve(process.cwd(), 'uploads');
}

const listCompanies = catchAsync(async (req, res) => {

  const perPage = Number(req.query.perPage || req.query.limit || 25);
  const page = Number(req.query.page || 1);
  const sort =
    req.query.sort || (req.query.sort_by ? `${req.query.sort_by}:${req.query.sort_dir || "asc"}` : undefined);

  let filter = {};
  if (req.query.filter) {
    try {
      filter = typeof req.query.filter === "string" ? JSON.parse(req.query.filter) : req.query.filter;
    } catch (e) {
      // ignore invalid JSON filter
    }
  }

  const q = req.query.search || req.query.q;
  if (q && String(q).trim().length) {
    filter.name = { contains: String(q).trim() };
  }

  const items = await companySvc.list({ filter, perPage, page, sort });
  const total = await companySvc.model.count({ where: filter }).catch(() => 0);

  res.json({ data: serializeForJson(items), meta: { total, page, perPage } });
});

const getCompany = catchAsync(async (req, res) => {
  const id = Number(req.params.id);
  if (!id) return res.status(400).json({ error: 'invalid_id' });

  const item = await companySvc.getById(BigInt(id));
  if (!item) return res.status(404).json({ error: 'not_found' });
  res.json({ data: serializeForJson(item) });
});

const createCompany = catchAsync(async (req, res) => {
  const body = req.body || {};
  const name = body.name;
  if (!name) return res.status(400).json({ error: 'name_required' });

  const data = {
    name: name,
    contact_name: body.contact_name || null,
    telephone_number: body.telephone_number || null,
    email: body.email || null,
    website: body.website || null,
    instagram: body.instagram || null,
    facebook: body.facebook || null,
    address_name: body.address_name || null,
    street: body.street || null,
    city: body.city || null,
    postal_code: body.postal_code || null,
    bank_name: body.bank_name || null,
    sort_code: body.sort_code || null,
    account_number: body.account_number || null,
    vat: body.vat || null,
    vat_percentage: body.vat_percentage || null,
    created_at: new Date(),
    updated_at: new Date(),
  };

  // files: company_logo and brochure (multer fields)
  try {
    if (req.files && req.files.company_logo && req.files.company_logo[0]) {
      const up = await uploadFile(req.files.company_logo[0], { allowedMimeTypes: [
        'image/jpeg','image/png','image/gif','image/webp','image/svg+xml'
      ], folder: 'company/logo' });
      if (up && up.url) data.company_logo = up.url;
    }

    if (req.files && req.files.brochure && req.files.brochure[0]) {
      const up = await uploadFile(req.files.brochure[0], { allowedMimeTypes: [
        'application/pdf','application/vnd.oasis.opendocument.text'
      ], folder: 'company/brochure' });
      if (up && up.url) data.brochure = up.url;
    }

    // admin_signature may be a base64 data URL
    if (body.admin_signature && typeof body.admin_signature === 'string' && body.admin_signature.length > 50) {
      const base = body.admin_signature.replace(/^data:.*;base64,/, '');
      const buf = Buffer.from(base, 'base64');
      const name = `signature-${Date.now()}.png`;
      // Use uploadFile to store signature (supports s3/local)
      const up = await uploadFile({ buffer: buf, originalname: name, mimetype: 'image/png' }, { folder: 'company/signature' });
      if (up && up.url) data.admin_signature = up.url;
    }
  } catch (err) {
    console.error('file upload error', err);
  }

  const created = await companySvc.create(data);
  res.status(201).json({ data: serializeForJson(created) });
});

const updateCompany = catchAsync(async (req, res) => {
  const id = Number(req.params.id);
  if (!id) return res.status(400).json({ error: 'invalid_id' });
  const body = req.body || {};

  const existing = await companySvc.getById(BigInt(id));
  if (!existing) return res.status(404).json({ error: 'not_found' });

  const data = {
    name: body.name || existing.name,
    contact_name: body.contact_name || existing.contact_name,
    telephone_number: body.telephone_number || existing.telephone_number,
    email: body.email || existing.email,
    website: body.website || existing.website,
    instagram: body.instagram || existing.instagram,
    facebook: body.facebook || existing.facebook,
    address_name: body.address_name || existing.address_name,
    street: body.street || existing.street,
    city: body.city || existing.city,
    postal_code: body.postal_code || existing.postal_code,
    bank_name: body.bank_name || existing.bank_name,
    sort_code: body.sort_code || existing.sort_code,
    account_number: body.account_number || existing.account_number,
    vat: body.vat || existing.vat,
    vat_percentage: body.vat_percentage || existing.vat_percentage,
    updated_at: new Date(),
  };

  try {
    if (req.files && req.files.company_logo && req.files.company_logo[0]) {
      const up = await uploadFile(req.files.company_logo[0], { allowedMimeTypes: [
        'image/jpeg','image/png','image/gif','image/webp','image/svg+xml'
      ] });
      if (up && up.url) {
        // delete old logo if not referenced elsewhere
        if (existing.company_logo) {
          const oldName = path.basename(existing.company_logo);
          const cnt = await companySvc.model.count({ where: { company_logo: existing.company_logo } });
          if (cnt <= 1) {
            try {
              if ((process.env.FILE_STORAGE || '').toLowerCase() === 's3') {
                // existing.company_logo stores key for s3
                await deleteObjectFromS3(existing.company_logo);
              } else {
                const p = path.join(getUploadsDir(), oldName);
                try { if (fs.existsSync(p)) await fs.promises.unlink(p); } catch (e) {}
              }
            } catch (e) {}
          }
        }
        data.company_logo = up.url;
      }
    } else if (body.new_company_logo) {
      data.company_logo = body.new_company_logo || null;
    }

    if (req.files && req.files.brochure && req.files.brochure[0]) {
      const up = await uploadFile(req.files.brochure[0], { allowedMimeTypes: [
        'application/pdf','application/vnd.oasis.opendocument.text'
      ] });
      if (up && up.url) {
        if (existing.brochure) {
          const oldName = path.basename(existing.brochure);
          const cnt = await companySvc.model.count({ where: { brochure: existing.brochure } });
          if (cnt <= 1) {
            try {
              if ((process.env.FILE_STORAGE || '').toLowerCase() === 's3') {
                await deleteObjectFromS3(existing.brochure);
              } else {
                const p = path.join(getUploadsDir(), oldName);
                try { if (fs.existsSync(p)) await fs.promises.unlink(p); } catch (e) {}
              }
            } catch (e) {}
          }
        }
        data.brochure = up.url;
      }
    }

    if (body.admin_signature && body.admin_signature.length > 20) {
      const base = body.admin_signature.replace(/^data:.*;base64,/, '');
      const buf = Buffer.from(base, 'base64');
      const name = `signature-${Date.now()}.png`;
      const up = await uploadFile({ buffer: buf, originalname: name, mimetype: 'image/png' }, { folder: 'company/signature' });
      if (up && up.url) data.admin_signature = up.url;
    }
  } catch (err) {
    console.error('update file error', err);
  }

  const updated = await companySvc.update(BigInt(id), data);
  res.json({ data: serializeForJson(updated) });
});

const deleteCompanies = catchAsync(async (req, res) => {
  // Delete many companies by CSV ids in params (route: /delete-many/:ids)
  const idsRaw = req.params.ids || (req.body && req.body.ids);
  if (!idsRaw) return res.status(400).json({ error: 'ids_required' });
  const ids = Array.isArray(idsRaw) ? idsRaw.map((i) => Number(i)) : String(idsRaw).split(',').map((i) => Number(i));

  // Prevent deletion if events reference these company ids
  const hasEvent = await prisma.event.findFirst({ where: { names_id: { in: ids } } });
  if (hasEvent) return res.status(400).json({ error: 'company_has_events', message: 'Cannot delete company. Associated events exist.' });
  const companies = await companySvc.list({ filter: { id: { in: ids.map((i) => BigInt(i)) } }, perPage: ids.length || undefined });
  for (const c of companies) {
    try {
      await removeCompanyFiles(c);
    } catch (e) {
      console.error('delete file error', e);
    }
  }

  await companySvc.forceDeleteMany(ids.map((i) => BigInt(i)));
  res.json({ ok: true });
});

// Delete single company (route: DELETE /:id)
const deleteCompany = catchAsync(async (req, res) => {
  const id = Number(req.params.id);
  if (!id) return res.status(400).json({ error: 'invalid_id' });

  // Prevent deletion if events reference this company id
  const hasEvent = await prisma.event.findFirst({ where: { names_id: id } });
  if (hasEvent) return res.status(400).json({ error: 'company_has_events', message: 'Cannot delete company. Associated events exist.' });

  const company = await companySvc.getById(BigInt(id));
  if (!company) return res.status(404).json({ error: 'not_found' });

  try {
    await removeCompanyFiles(company);
  } catch (e) {
    console.error('delete file error', e);
  }

  await companySvc.forceDelete(BigInt(id));
  res.json({ ok: true });
});

// Helper: remove uploaded files for a company record (handles s3/local and shared refs)
async function removeCompanyFiles(c) {
  const uploadsDir = getUploadsDir();
  if (c.company_logo) {
    const name = path.basename(c.company_logo);
    const cnt = await prisma.companyName.count({ where: { company_logo: c.company_logo } });
    if (cnt <= 1) {
      if ((process.env.FILE_STORAGE || '').toLowerCase() === 's3') {
        try { await deleteObjectFromS3(c.company_logo); } catch (e) {}
      } else {
        const p = path.join(uploadsDir, name);
        try { if (fs.existsSync(p)) await fs.promises.unlink(p); } catch (e) {}
      }
    }
  }

  if (c.brochure) {
    const name = path.basename(c.brochure);
    const cnt = await prisma.companyName.count({ where: { brochure: c.brochure } });
    if (cnt <= 1) {
      if ((process.env.FILE_STORAGE || '').toLowerCase() === 's3') {
        try { await deleteObjectFromS3(c.brochure); } catch (e) {}
      } else {
        const p = path.join(uploadsDir, name);
        try { if (fs.existsSync(p)) await fs.promises.unlink(p); } catch (e) {}
      }
    }
  }

  if (c.admin_signature) {
    const name = path.basename(c.admin_signature);
    const cnt = await companySvc.model.count({ where: { admin_signature: c.admin_signature } });
    if (cnt <= 1) {
      if ((process.env.FILE_STORAGE || '').toLowerCase() === 's3') {
        try { await deleteObjectFromS3(c.admin_signature); } catch (e) {}
      } else {
        const p = path.join(uploadsDir, name);
        try { if (fs.existsSync(p)) await fs.promises.unlink(p); } catch (e) {}
      }
    }
  }
}

export default { listCompanies, getCompany, createCompany, updateCompany, deleteCompany, deleteCompanies };
